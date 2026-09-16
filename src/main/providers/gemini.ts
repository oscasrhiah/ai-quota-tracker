import { SessionExpiredError, FetchProvider, ProviderResult, EndpointTry, UsageWindow } from './types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BASE = 'https://gemini.google.com'
const DEFAULT_RPCID = 'jSf9Qc'

/**
 * Gemini 網頁版沒有公開用量 API，前端走 Google 的 batchexecute RPC 協定。
 * 這裡的做法（抓頁面 HTML 挖出 SNlM0e 防 CSRF token、組 batchexecute POST、解析 chunked 回應）
 * 是根據 Google 這類前端的公開已知架構實作，還沒在真實帳號上驗證過，屬於實驗性質：
 * 如果 Google 改版或欄位意義猜錯，會在 tried／error 裡看得到原始回應，方便一起調整。
 */

function describeError(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: unknown }).cause
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : ''
    return causeMsg ? `${e.message}（原因：${causeMsg}）` : e.message
  }
  return String(e)
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  method: 'GET' | 'POST',
  body?: string
): Promise<{ status: number; text: string }> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: { ...headers, 'User-Agent': UA },
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(20000)
    })
  } catch (e) {
    throw new Error(`連線失敗：${describeError(e)}`)
  }
  const text = await res.text()
  return { status: res.status, text }
}

function extractToken(html: string): { at: string | null; bl: string | null; sid: string | null } {
  const at = html.match(/"SNlM0e":"([^"]+)"/)?.[1] ?? null
  const bl = html.match(/"cfb2h":"([^"]+)"/)?.[1] ?? null
  const sid = html.match(/"FdrFJe":"(-?\d+)"/)?.[1] ?? null
  return { at, bl, sid }
}

/** 從 text[start] 開始找一個完整的 JSON 陣列／物件（括號配對＋跳過字串內的括號），回傳結束位置（不含） */
function scanJsonValue(text: string, start: number): number {
  let i = start
  while (i < text.length && /\s/.test(text[i])) i++
  if (text[i] !== '[' && text[i] !== '{') return -1
  let depth = 0
  let inStr = false
  let esc = false
  for (; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * batchexecute 回應是 )]}' 前綴 ＋ 一串「長度\nJSON」重複區塊；Google 給的長度數字實測會跟實際字元數差 1
 * （可能是位元組數與 JS 字串長度算法不同調），所以長度只拿來當作「這裡有一段」的提示，
 * 實際切割改用括號配對找出完整 JSON 值，不依賴那個數字。
 */
function parseChunks(raw: string): unknown[] {
  const text = raw.replace(/^\)\]\}'?\s*/, '')
  const out: unknown[] = []
  let pos = 0
  while (pos < text.length) {
    while (pos < text.length && /\s/.test(text[pos])) pos++
    if (pos >= text.length) break
    const numMatch = /^(\d+)\s*\n/.exec(text.slice(pos, pos + 20))
    if (numMatch) pos += numMatch[0].length
    const end = scanJsonValue(text, pos)
    if (end === -1) break
    const chunk = text.slice(pos, end)
    pos = end
    try {
      out.push(JSON.parse(chunk))
    } catch {
      /* 略過解析不出來的區塊 */
    }
  }
  return out
}

/** 每個區塊其實是「一個陣列包多筆紀錄」（wrb.fr／di／af.httprm 是同一層的手足元素），要再往下一層找 */
function findRpcPayload(chunks: unknown[], rpcid: string): unknown {
  for (const c of chunks) {
    if (!Array.isArray(c)) continue
    for (const item of c) {
      if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcid && typeof item[2] === 'string') {
        try {
          return JSON.parse(item[2])
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * 把解析出來的陣列轉成用量視窗；欄位位置的意義（哪個是額度上限、哪個是已用比例）是依公開資料推測，
 * 還沒在真實帳號上核對過，先用「額度 1／額度 2」等通用標籤，等你回報實際數字後再校正對應的中文標籤。
 */
function toWindows(payload: unknown): UsageWindow[] {
  const windows: UsageWindow[] = []
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return windows
  const entries = payload[1] as unknown[]
  entries.forEach((entry, i) => {
    if (!Array.isArray(entry)) return
    const usedFrac = typeof entry[1] === 'number' ? entry[1] : null
    const resetPair = Array.isArray(entry[3]) ? (entry[3] as unknown[])[0] : null
    const resetSec = Array.isArray(resetPair) && typeof resetPair[0] === 'number' ? (resetPair[0] as number) : null
    if (usedFrac === null) return
    const usedPct = Math.max(0, Math.min(100, usedFrac * 100))
    windows.push({
      id: `gemini-window-${i}`,
      label: `額度 ${i + 1}`,
      remainingPct: Math.round((100 - usedPct) * 10) / 10,
      resetsAtMs: resetSec !== null ? resetSec * 1000 : null,
      detail: `原始資料：${JSON.stringify(entry)}`
    })
  })
  return windows
}

async function fetchGemini(cookie: string, customRpcId?: string): Promise<ProviderResult> {
  const c = cookie.trim()
  if (!c) throw new Error('尚未設定 Gemini 連線')
  const rpcid = (customRpcId ?? '').trim() && /^[A-Za-z0-9_-]{4,20}$/.test(customRpcId ?? '') ? (customRpcId as string) : DEFAULT_RPCID

  const cookieHeaders = { Cookie: c, Origin: BASE, Referer: `${BASE}/app` }
  const tried: EndpointTry[] = []

  // 1) 抓頁面 HTML，挖出 SNlM0e（at token）／cfb2h（build label）／FdrFJe（f.sid）
  let html = ''
  for (const path of ['/app', '/']) {
    try {
      const r = await fetchText(`${BASE}${path}`, { ...cookieHeaders, Accept: 'text/html' }, 'GET')
      tried.push({ url: path, method: 'GET', status: r.status })
      if (r.status === 401 || r.status === 403) throw new SessionExpiredError('Gemini')
      if (r.status === 200 && r.text.length > 0) {
        html = r.text
        break
      }
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e
      tried.push({ url: path, method: 'GET', status: describeError(e) })
    }
  }
  if (!html) {
    throw new Error(`讀不到 Gemini 頁面（已試：${tried.map((t) => `${t.method} ${t.url}→${t.status}`).join('、')}）`)
  }

  const { at, bl, sid } = extractToken(html)
  if (!at) {
    throw new Error('在 Gemini 頁面裡找不到防 CSRF token（SNlM0e），可能是 Cookie 沒登入、或 Google 改版了頁面結構')
  }

  // 2) 組 batchexecute POST
  const reqId = Math.floor(Math.random() * 900000) + 100000
  const params = new URLSearchParams({
    rpcids: rpcid,
    'source-path': '/usage',
    hl: 'zh-TW',
    _reqid: String(reqId),
    rt: 'c'
  })
  if (bl) params.set('bl', bl)
  if (sid) params.set('f.sid', sid)

  const fReq = JSON.stringify([[[rpcid, '[null]', null, 'generic']]])
  const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(at)}`

  const postUrl = `${BASE}/_/BardChatUi/data/batchexecute?${params.toString()}`
  const r = await fetchText(
    postUrl,
    { ...cookieHeaders, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    'POST',
    body
  )
  tried.push({ url: `/_/BardChatUi/data/batchexecute?rpcids=${rpcid}`, method: 'POST', status: r.status })
  if (r.status === 401 || r.status === 403) throw new SessionExpiredError('Gemini')
  if (r.status !== 200) {
    throw new Error(`Gemini batchexecute 回應 HTTP ${r.status}，回應前 300 字：${r.text.slice(0, 300)}`)
  }

  const chunks = parseChunks(r.text)
  const payload = findRpcPayload(chunks, rpcid)
  if (payload === null) {
    throw new Error(`回應解析不出 rpcid=${rpcid} 的資料，回應前 300 字：${r.text.slice(0, 300)}`)
  }
  const windows = toWindows(payload)
  if (windows.length === 0) {
    throw new Error(`解析出資料但沒有用量欄位，原始結構：${JSON.stringify(payload).slice(0, 300)}`)
  }

  return {
    snapshot: { windows, fields: ['rpcid:' + rpcid] },
    source: `batchexecute:${rpcid}`,
    tried
  }
}

export function createGeminiProvider(): FetchProvider {
  return {
    id: 'gemini',
    name: 'Gemini',
    site: 'gemini.google.com',
    color: '#4285f4',
    fetch: (cookie: string, endpoint?: string) => fetchGemini(cookie, endpoint)
  }
}
