import { SessionExpiredError, FetchProvider, ProviderResult, UsageWindow } from './types'

/**
 * GitHub Copilot 個人訂閱用量：github.com/settings/billing/ai_usage 頁面。
 * 這個頁面最上面的「Included credits」「Additional usage」兩個進度條是伺服器端渲染好的，
 * 直接嵌在 HTML 裡一個 role="progressbar" 的 <span> 上，用 aria-valuetext 屬性存了
 * 「1500 of 1500 credits used」這種給無障礙工具讀的純文字——比解析內部 JSON API 穩定，
 * 因為這是給螢幕報讀器用的語意標記，官方比較不會隨便改。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BASE = 'https://github.com'

function describeError(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: unknown }).cause
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : ''
    return causeMsg ? `${e.message}（原因：${causeMsg}）` : e.message
  }
  return String(e)
}

async function fetchHtml(url: string, cookie: string): Promise<{ status: number; text: string }> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(20000)
    })
  } catch (e) {
    throw new Error(`連線失敗：${describeError(e)}`)
  }
  const text = await res.text()
  return { status: res.status, text }
}

/** 找出 aria-label 符合的 ProgressBar.Item <span>（自封閉標籤，屬性間沒有巢狀 >，抓到第一個 > 就是結尾） */
function findProgressBarTag(html: string, ariaLabel: string): string | null {
  const re = /<span[^>]*?data-component="ProgressBar\.Item"[^>]*?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[0].includes(`aria-label="${ariaLabel}"`)) return m[0]
  }
  return null
}

function extractAriaValueText(tag: string): string | null {
  return tag.match(/aria-valuetext="([^"]+)"/)?.[1] ?? null
}

function parseUsedOfTotal(text: string): { used: number; total: number } | null {
  const m = text.match(/\$?([\d,.]+)\s+of\s+\$?([\d,.]+)/i)
  if (!m) return null
  const used = Number(m[1].replace(/,/g, ''))
  const total = Number(m[2].replace(/,/g, ''))
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null
  return { used, total }
}

/** 在進度條標籤附近的一段文字裡找「Resets in N days on <日期>」，抓出重置日期 */
function findResetDate(html: string, tag: string): number | null {
  const idx = html.indexOf(tag)
  if (idx === -1) return null
  const windowText = html.slice(idx, idx + 1500)
  const m = windowText.match(/Resets?\s*(?:in\s+\d+\s+days?\s*)?on\s+([A-Za-z]+ \d{1,2},? \d{4})/i)
  if (!m) return null
  const ms = Date.parse(m[1])
  return Number.isFinite(ms) ? ms : null
}

async function fetchCopilot(cookie: string): Promise<ProviderResult> {
  const c = cookie.trim()
  if (!c) throw new Error('尚未設定 GitHub Copilot 連線')

  const pageUrl = `${BASE}/settings/billing/ai_usage`
  const page = await fetchHtml(pageUrl, c)
  if (page.status === 401 || page.status === 403) throw new SessionExpiredError('GitHub Copilot')
  if (page.status !== 200) {
    throw new Error(`讀不到帳單頁面（HTTP ${page.status}），可能是 Cookie 過期或帳號沒有 Copilot 訂閱`)
  }

  const windows: UsageWindow[] = []

  const includedTag = findProgressBarTag(page.text, 'Included usage progress')
  if (includedTag) {
    const valueText = extractAriaValueText(includedTag)
    const parsed = valueText ? parseUsedOfTotal(valueText) : null
    if (parsed) {
      windows.push({
        id: 'copilot-included',
        label: '月度額度',
        remainingPct: Math.round((1 - parsed.used / parsed.total) * 1000) / 10,
        resetsAtMs: findResetDate(page.text, includedTag),
        detail: `${parsed.used} / ${parsed.total} credits`
      })
    }
  }

  const additionalTag = findProgressBarTag(page.text, 'Additional usage progress')
  if (additionalTag) {
    const valueText = extractAriaValueText(additionalTag)
    const parsed = valueText ? parseUsedOfTotal(valueText) : null
    if (parsed) {
      windows.push({
        id: 'copilot-additional',
        label: '額外用量預算',
        remainingPct: Math.round((1 - parsed.used / parsed.total) * 1000) / 10,
        resetsAtMs: null,
        detail: `$${parsed.used} / $${parsed.total}`
      })
    }
  }

  if (windows.length === 0) {
    throw new Error(
      `頁面裡找不到用量進度條（官方可能改版了 aria-label 或 HTML 結構），頁面長度：${page.text.length} 字`
    )
  }

  return { snapshot: { windows, fields: [] }, source: 'ai_usage (HTML aria-valuetext)', tried: [] }
}

export function createCopilotProvider(): FetchProvider {
  return {
    id: 'copilot',
    name: 'GitHub Copilot',
    site: 'github.com',
    color: '#8957e5',
    fetch: (cookie: string) => fetchCopilot(cookie)
  }
}
