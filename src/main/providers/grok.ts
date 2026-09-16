import { SessionExpiredError, FetchProvider, ProviderResult, UsageWindow } from './types'
import { fetchViaHiddenBrowser } from '../hiddenBrowser'

/**
 * Grok（grok.com）用量：邏輯照抄自公開的「Grok Usage Watch」瀏覽器擴充功能。
 * grok.com 有 Cloudflare 的 TLS／行為指紋防護，直接用 Node fetch 送出去的請求會被當成
 * 非瀏覽器流量擋下來（回應是 Cloudflare 的「Just a moment」驗證頁，不是真的過期）。
 * 所以這裡改用隱藏的真實 Chromium 分頁（hiddenBrowser.ts）送請求，而不是 Node fetch。
 *
 * 三段流程：
 * 1) GET  /rest/subscriptions          → 有沒有生效中的付費訂閱
 * 2) 付費：POST /grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig（gRPC-Web，需手動解 protobuf）
 *    免費：POST /rest/rate-limits       → 一般 JSON，直接有 totalQueries／remainingQueries
 */

const BASE = 'https://grok.com'

const PRODUCT_LABELS: Record<number, string> = {
  2: 'Grok Build',
  4: '對話',
  5: '圖像',
  6: '語音'
}

function isCloudflareChallenge(text: string): boolean {
  return /just a moment|cf-browser-verification|cf_chl_|challenges\.cloudflare\.com|attention required/i.test(text)
}

function checkAuthOrThrow(status: number, text: string, provider: string): void {
  if (status !== 401 && status !== 403) return
  if (isCloudflareChallenge(text)) {
    throw new Error(`${provider} 的請求被 Cloudflare 擋下來了（回應前 200 字：${text.slice(0, 200)}）`)
  }
  throw new SessionExpiredError(provider)
}

/** 最小 protobuf 線格式解碼器：只認 varint／length-delimited／32-bit 三種 wire type，夠用即可 */
function decodeProto(bytes: Uint8Array): Record<number, unknown[]> {
  const out: Record<number, unknown[]> = {}
  let at = 0
  const varint = (): number => {
    let value = 0
    let scale = 1
    while (at < bytes.length) {
      const byte = bytes[at++]
      value += (byte & 0x7f) * scale
      if (!(byte & 0x80)) break
      scale *= 128
    }
    return value
  }
  while (at < bytes.length) {
    const key = varint()
    const field = Math.floor(key / 8)
    const wire = key & 7
    if (!field) break
    if (wire === 0) {
      ;(out[field] ??= []).push(varint())
    } else if (wire === 2) {
      const len = varint()
      if (at + len > bytes.length) break
      ;(out[field] ??= []).push(bytes.subarray(at, at + len))
      at += len
    } else if (wire === 5) {
      ;(out[field] ??= []).push(new DataView(bytes.buffer, bytes.byteOffset + at, 4).getFloat32(0, true))
      at += 4
    } else if (wire === 1) {
      at += 8
    } else {
      break
    }
  }
  return out
}

function first(fields: Record<number, unknown[]>, n: number): unknown {
  const v = fields[n]
  return v && v.length ? v[0] : undefined
}

interface PaidUsage {
  used: number
  resetAt: number | null
  products: { id: number; label: string; percent: number }[]
}

function unwrapGrpcWebFrame(bytes: Uint8Array): Uint8Array {
  let at = 0
  while (at + 5 <= bytes.length) {
    const flag = bytes[at]
    const view = new DataView(bytes.buffer, bytes.byteOffset + at + 1, 4)
    const len = view.getUint32(0, false)
    const body = bytes.subarray(at + 5, at + 5 + len)
    at += 5 + len
    if ((flag & 0x80) === 0) return body
  }
  throw new Error('gRPC-Web 回應沒有資料訊框')
}

function readPaidUsage(frame: Uint8Array): PaidUsage | null {
  const top = decodeProto(frame)
  const configBytes = first(top, 1) as Uint8Array | undefined
  if (!configBytes) return null
  const config = decodeProto(configBytes)

  let resetAt: number | null = null
  const periodEnd = first(config, 5) as Uint8Array | undefined
  if (periodEnd) {
    const seconds = first(decodeProto(periodEnd), 1)
    if (typeof seconds === 'number' && seconds > 0) resetAt = seconds * 1000
  }

  const productField = (config[7] ?? []) as Uint8Array[]
  const hasProductField = productField.length > 0
  const products = productField
    .map((entry) => {
      const parsed = decodeProto(entry)
      const id = first(parsed, 1) as number | undefined
      const percent = first(parsed, 2)
      return { id: id ?? 0, label: PRODUCT_LABELS[id ?? 0] ?? '其他', percent: typeof percent === 'number' ? percent : 0 }
    })
    .filter((p) => p.percent > 0)
    .sort((a, b) => b.percent - a.percent)

  const usedRaw = first(config, 1)
  if (typeof usedRaw !== 'number' && resetAt === null && !hasProductField) return null
  const used = typeof usedRaw === 'number' ? Math.max(0, Math.min(100, usedRaw)) : 0

  return { used, resetAt, products }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = Buffer.from(b64, 'base64')
  return new Uint8Array(bin)
}

async function fetchGrok(cookie: string): Promise<ProviderResult> {
  const c = cookie.trim()
  if (!c) throw new Error('尚未設定 Grok 連線')

  const [subsRes] = await fetchViaHiddenBrowser('grok', `${BASE}/`, c, [
    { url: `${BASE}/rest/subscriptions`, method: 'GET' }
  ])
  if (subsRes.error) throw new Error(`連線失敗：${subsRes.error}`)
  checkAuthOrThrow(subsRes.status, subsRes.text ?? '', 'Grok')
  if (subsRes.status !== 200 || !subsRes.text) throw new Error(`Grok 訂閱狀態讀取失敗（HTTP ${subsRes.status}）`)

  let subsData: unknown
  try {
    subsData = JSON.parse(subsRes.text)
  } catch {
    throw new Error(`Grok 訂閱狀態回應不是 JSON：${subsRes.text.slice(0, 200)}`)
  }
  const subList =
    subsData && typeof subsData === 'object' && Array.isArray((subsData as { subscriptions?: unknown }).subscriptions)
      ? ((subsData as { subscriptions: unknown[] }).subscriptions as { status?: unknown }[])
      : []
  const isPaid = subList.some((s) => s.status === 'SUBSCRIPTION_STATUS_ACTIVE')

  const windows: UsageWindow[] = []

  if (isPaid) {
    const [r] = await fetchViaHiddenBrowser('grok', `${BASE}/`, c, [
      {
        url: `${BASE}/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig`,
        method: 'POST',
        headers: { 'Content-Type': 'application/grpc-web+proto', 'X-Grpc-Web': '1' },
        emptyGrpcBody: true,
        binary: true
      }
    ])
    if (r.error) throw new Error(`連線失敗：${r.error}`)
    checkAuthOrThrow(r.status, r.base64 ? Buffer.from(r.base64, 'base64').toString('utf-8') : '', 'Grok')
    if (r.status !== 200 || !r.base64) throw new Error(`Grok 用量讀取失敗（HTTP ${r.status}）`)
    const paid = readPaidUsage(unwrapGrpcWebFrame(base64ToBytes(r.base64)))
    if (!paid) throw new Error('Grok 回應解析不出用量欄位（官方可能改版）')
    windows.push({
      id: 'grok-weekly',
      label: '每週額度',
      remainingPct: Math.round((100 - paid.used) * 10) / 10,
      resetsAtMs: paid.resetAt,
      detail: `已用 ${paid.used}%`
    })
    paid.products.forEach((p) => {
      windows.push({
        id: `grok-product-${p.id}`,
        label: p.label,
        remainingPct: Math.round((100 - p.percent) * 10) / 10,
        resetsAtMs: paid.resetAt,
        detail: `原始 id=${p.id}`
      })
    })
  } else {
    const [r] = await fetchViaHiddenBrowser('grok', `${BASE}/`, c, [
      {
        url: `${BASE}/rest/rate-limits`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKind: 'DEFAULT', modelName: 'grok-3' })
      }
    ])
    if (r.error) throw new Error(`連線失敗：${r.error}`)
    checkAuthOrThrow(r.status, r.text ?? '', 'Grok')
    if (r.status !== 200 || !r.text) throw new Error(`Grok 用量讀取失敗（HTTP ${r.status}）`)
    let data: unknown
    try {
      data = JSON.parse(r.text)
    } catch {
      throw new Error(`Grok 回應不是 JSON：${r.text.slice(0, 200)}`)
    }
    const d = (data ?? {}) as { totalQueries?: unknown; remainingQueries?: unknown }
    const total = Number(d.totalQueries)
    const remaining = Number(d.remainingQueries)
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(remaining)) {
      throw new Error('Grok 回應缺少用量欄位（官方可能改版）')
    }
    windows.push({
      id: 'grok-free',
      label: '額度',
      remainingPct: Math.round((remaining / total) * 1000) / 10,
      resetsAtMs: null,
      detail: `${remaining} / ${total}`
    })
  }

  return { snapshot: { windows, fields: [] }, source: isPaid ? 'GetGrokCreditsConfig' : 'rate-limits', tried: [] }
}

export function createGrokProvider(): FetchProvider {
  return {
    id: 'grok',
    name: 'Grok',
    site: 'grok.com',
    color: '#e5e7eb',
    fetch: (cookie: string) => fetchGrok(cookie)
  }
}
