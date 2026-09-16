import { normalizeUsage } from './normalize'
import { SessionExpiredError, FetchProvider, ProviderResult, EndpointTry } from './types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** Google 系網站常在 JSON 前面加防劫持前綴，例如 )]}'、while(1);、for(;;); */
function stripAntiHijack(text: string): string {
  return text
    .replace(/^\)\]\}'?\s*/, '')
    .replace(/^while\s*\(\s*1\s*\)\s*;?\s*/, '')
    .replace(/^for\s*\(\s*;;\s*\)\s*;?\s*/, '')
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  method: 'GET' | 'POST'
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    method,
    headers: { ...headers, 'User-Agent': UA, Accept: 'application/json, text/plain, */*' },
    ...(method === 'POST' ? { body: '{}' } : {}),
    signal: AbortSignal.timeout(20000)
  })
  const raw = await res.text()
  let data: unknown = null
  try {
    data = JSON.parse(stripAntiHijack(raw))
  } catch {
    /* 非 JSON（例如 Google 的 batchexecute 格式），無法解析 */
  }
  return { status: res.status, data }
}

export interface GenericProviderConfig {
  id: string
  name: string
  site: string
  color: string
  /** 端點的基底網址；若使用者填的是相對路徑會拼在這後面。留空則要求使用者貼完整網址 */
  defaultBase?: string
  /** 內建候選路徑／網址（best-effort 猜測，找不到時仍需使用者自行用開發者工具找） */
  candidates?: string[]
}

function toEntry(base: string | undefined, p: string): string {
  if (/^https?:\/\//i.test(p)) return p
  if (!base) return p
  return `${base}${p.startsWith('/') ? p : `/${p}`}`
}

/**
 * 通用的「貼 Cookie＋自訂端點」Provider：給沒有公開穩定用量 API 的服務用
 * （例如 Google 系產品，前端多半走高度混淆的內部協定）。
 * 找不到內建候選時，使用者需要自己在瀏覽器開發者工具的網路頁籤找出真正的用量請求，
 * 把路徑或完整網址貼到「自訂端點」欄位。
 */
export function createGenericCookieProvider(cfg: GenericProviderConfig): FetchProvider {
  return {
    id: cfg.id,
    name: cfg.name,
    site: cfg.site,
    color: cfg.color,
    fetch: async (cookie: string, endpoint?: string): Promise<ProviderResult> => {
      const c = cookie.trim()
      if (!c) throw new Error(`尚未設定 ${cfg.name} 連線`)
      const headers: Record<string, string> = {
        Cookie: c,
        ...(cfg.defaultBase ? { Origin: cfg.defaultBase, Referer: `${cfg.defaultBase}/` } : {})
      }

      const custom = (endpoint ?? '').trim()
      const urls = [
        ...(custom ? [toEntry(cfg.defaultBase, custom)] : []),
        ...(cfg.candidates ?? []).map((p) => toEntry(cfg.defaultBase, p))
      ]

      if (urls.length === 0) {
        throw new Error(
          `${cfg.name} 沒有已知的用量端點。請在 ${cfg.site} 開發者工具的網路頁籤篩選 quota／usage／limit，` +
            '找到會回傳用量數字的請求後，把它的完整網址貼到「自訂端點」欄位再試一次。'
        )
      }

      const tried: EndpointTry[] = []
      for (const url of urls) {
        for (const method of ['GET', 'POST'] as const) {
          try {
            const r = await fetchJson(url, headers, method)
            tried.push({ url, method, status: r.status })
            if (r.status === 401 || r.status === 403) throw new SessionExpiredError(cfg.name)
            if (r.status === 200 && r.data && typeof r.data === 'object') {
              const snap = normalizeUsage(r.data)
              if (snap.windows.length > 0) return { snapshot: snap, source: url, tried }
            }
          } catch (e) {
            if (e instanceof SessionExpiredError) throw e
            tried.push({ url, method, status: 'error' })
          }
        }
      }
      throw new Error(
        `找不到可用的 ${cfg.name} 用量端點（已試：${tried.map((t) => `${t.method} ${t.url}→${t.status}`).join('、')}）。` +
          '請在開發者工具的網路頁籤篩選 quota／usage／limit，把找到的完整網址貼到「自訂端點」。' +
          '注意：Google 系網站有些回應是內部 batchexecute 格式，不是一般 JSON，可能無法解析。'
      )
    }
  }
}
