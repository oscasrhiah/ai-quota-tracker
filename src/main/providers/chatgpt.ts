import { normalizeUsage } from './normalize'
import { SessionExpiredError, FetchProvider, ProviderResult, EndpointTry } from './types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** OpenAI 常改端點名稱：依序探測，命中第一個能解析出用量視窗的 */
const CANDIDATES = [
  '/backend-api/wham/usage',
  '/backend-api/pageConfigs/usage_limits',
  '/backend-api/conversation_limit',
  '/backend-api/accounts/check/v4-2023-04-27',
  '/public-api/conversation_limit',
  '/backend-api/accounts/check',
  '/backend-api/me',
  '/backend-api/usage',
  '/backend-api/limits',
  '/backend-api/rate_limits'
]

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    headers: { ...headers, 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, data }
}

async function postJson(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(20000)
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, data }
}

/**
 * ChatGPT 訂閱用量：官方沒有公開 API，改用網頁版內部端點
 *（跟 tokn.watch / GPTKarma 等現有工具相同做法）。
 * 需要使用者在 chatgpt.com 登入後的 Cookie；只送往 chatgpt.com，不經第三方。
 */
async function fetchChatGPT(cookie: string, customPath?: string): Promise<ProviderResult> {
  const base = 'https://chatgpt.com'
  const c = cookie.trim()
  if (!c) throw new Error('尚未設定 ChatGPT 連線')

  const cookieHeaders = { Cookie: c, Origin: base, Referer: `${base}/` }

  // 1) 用 session 換 accessToken（backend-api 需要 Bearer）
  let bearer = ''
  try {
    const sess = await getJson(`${base}/api/auth/session`, cookieHeaders)
    if (sess.status === 401 || sess.status === 403) throw new SessionExpiredError('ChatGPT')
    const token = (sess.data as { accessToken?: unknown } | null)?.accessToken
    if (typeof token === 'string' && token.length > 0) bearer = token
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e
    // session 端點失敗不直接放棄，後面用純 Cookie 再試一次
  }

  const headers: Record<string, string> = { ...cookieHeaders }
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`

  // 2) 自訂端點優先（支援路徑或完整網址），其次依序探測候選端點（GET 不行就試 POST）
  const custom = (customPath ?? '').trim()
  const toEntry = (p: string): { label: string; url: string; needBearer: boolean } => {
    const path = p.startsWith('/') ? p : `/${p}`
    // public-api 需要 Bearer token，backend-api 中 wham/usage 也需要
    const needBearer = /^\/public-api\//.test(path) || /\/wham\//.test(path) || /\/pageConfigs\//.test(path)
    const url = /^https?:\/\//i.test(p) ? p : `${base}${path}`
    return { label: p, url, needBearer }
  }
  const paths = [
    ...(custom ? [toEntry(custom)] : []),
    ...CANDIDATES.filter((p) => p !== custom).map((p) => toEntry(p))
  ]
  const tried: EndpointTry[] = []
  for (const { label: path, url, needBearer } of paths) {
    // 有些端點需要 Bearer token，若無法取得則跳過
    const tryHeaders = needBearer && !bearer ? undefined : headers
    if (needBearer && !bearer) {
      tried.push({ url: path, method: 'GET', status: 'no-bearer' })
      tried.push({ url: path, method: 'POST', status: 'no-bearer' })
      continue
    }
    try {
      const r = await getJson(url, tryHeaders ?? headers)
      tried.push({ url: path, method: 'GET', status: r.status })
      if (r.status === 401 || r.status === 403) throw new SessionExpiredError('ChatGPT')
      if (r.status === 200 && r.data && typeof r.data === 'object') {
        const snap = normalizeUsage(r.data)
        if (snap.windows.length > 0) return { snapshot: snap, source: path, tried }
      }
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e
      tried.push({ url: path, method: 'GET', status: 'error' })
    }
    try {
      const r = await postJson(url, tryHeaders ?? headers)
      tried.push({ url: path, method: 'POST', status: r.status })
      if (r.status === 401 || r.status === 403) throw new SessionExpiredError('ChatGPT')
      if (r.status === 200 && r.data && typeof r.data === 'object') {
        const snap = normalizeUsage(r.data)
        if (snap.windows.length > 0) return { snapshot: snap, source: `${path} (POST)`, tried }
      }
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e
      tried.push({ url: path, method: 'POST', status: 'error' })
    }
  }
  throw new Error(
    `找不到可用的 ChatGPT 用量端點（已試：${tried.map((t) => `${t.method} ${t.url}→${t.status}`).join('、')}）。` +
      '請在瀏覽器開發者工具的網路頁籤篩選 limit／usage，找到用量請求後把路徑貼到「自訂端點」。'
  )
}

export function createChatGPTProvider(): FetchProvider {
  return {
    id: 'chatgpt',
    name: 'ChatGPT',
    site: 'chatgpt.com',
    color: '#10a37f',
    fetch: (cookie: string, endpoint?: string) => fetchChatGPT(cookie, endpoint)
  }
}
