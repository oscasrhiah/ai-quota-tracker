import { normalizeUsage } from './normalize'
import { SessionExpiredError, FetchProvider, ProviderResult, ProviderSnapshot } from './types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function fetchJson(url: string, cookie: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'application/json' },
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

function badAuth(status: number): boolean {
  return status === 401 || status === 403
}

function pickOrgId(data: unknown, cookie: string): string | null {
  // lastActiveOrg cookie 常直接帶 org id
  const m = cookie.match(/lastActiveOrg=([0-9a-f-]{10,})/i)
  const hint = m ? m[1] : null
  if (Array.isArray(data)) {
    if (hint && data.some((o) => (o as { id?: unknown })?.id === hint || (o as { uuid?: unknown })?.uuid === hint)) {
      return hint
    }
    const first = data[0] as { id?: unknown; uuid?: unknown } | undefined
    const id = first?.id ?? first?.uuid
    return typeof id === 'string' ? id : null
  }
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>
    for (const k of ['organizations', 'orgs', 'data', 'items']) {
      if (Array.isArray(rec[k])) return pickOrgId(rec[k], cookie)
    }
    if (typeof rec['id'] === 'string') return rec['id'] as string
    if (typeof rec['uuid'] === 'string') return rec['uuid'] as string
  }
  return hint
}

/**
 * Claude 訂閱用量：官方「設定 → 用量」頁背後的內部端點
 * GET /api/organizations/{orgId}/usage（跟 ClaudeUsageBar 等現有工具相同做法）。
 * 需要使用者在 claude.ai 登入後的 Cookie；只送往 claude.ai，不經第三方。
 */
async function fetchClaude(cookie: string, savedOrgId?: string): Promise<{ orgId: string; snapshot: ProviderSnapshot }> {
  const c = cookie.trim()
  if (!c) throw new Error('尚未設定 Claude 連線')

  let orgId = (savedOrgId ?? '').trim() || null
  if (!orgId) {
    const orgs = await fetchJson('https://claude.ai/api/organizations', c)
    if (badAuth(orgs.status)) throw new SessionExpiredError('Claude')
    if (orgs.status !== 200) throw new Error(`Claude 組織讀取失敗（HTTP ${orgs.status}）`)
    orgId = pickOrgId(orgs.data, c)
    if (!orgId) throw new Error('找不到 Claude 組織 ID，請改用手動貼上用量頁網址中的 ID')
  }

  const r = await fetchJson(`https://claude.ai/api/organizations/${orgId}/usage`, c)
  if (badAuth(r.status)) throw new SessionExpiredError('Claude')
  if (r.status === 404 && savedOrgId) {
    // 存的 orgId 失效，重新探索一次
    return fetchClaude(c, undefined)
  }
  if (r.status !== 200 || !r.data || typeof r.data !== 'object') {
    throw new Error(`Claude 用量讀取失敗（HTTP ${r.status}），可能是官方改版，請稍後再試`)
  }
  return { orgId, snapshot: normalizeUsage(r.data) }
}

export function createClaudeProvider(): FetchProvider {
  return {
    id: 'claude',
    name: 'Claude',
    site: 'claude.ai',
    color: '#d97757',
    fetch: async (cookie: string, savedOrgId?: string): Promise<ProviderResult> => {
      const { orgId, snapshot } = await fetchClaude(cookie, savedOrgId)
      return { snapshot, source: `organizations/${orgId}/usage`, tried: [], orgId }
    }
  }
}
