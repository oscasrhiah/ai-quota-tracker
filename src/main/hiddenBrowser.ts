import { BrowserWindow } from 'electron'

/**
 * 給像 Grok 這種被 Cloudflare 用 TLS／行為指紋擋掉 Node fetch 的服務用：
 * 開一個隱藏的真實 Chromium 分頁（不顯示給使用者看），把 Cookie 灌進該分頁的 session，
 * 導覽到官方網站後，在頁面自己的 JS context 裡執行 fetch()——這樣送出去的才是
 * 「真的瀏覽器」流量，能通過只認瀏覽器指紋的防護。
 */

const windows = new Map<string, BrowserWindow>()

function parseCookieHeader(cookieHeader: string): { name: string; value: string }[] {
  return cookieHeader
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const idx = p.indexOf('=')
      if (idx === -1) return { name: p, value: '' }
      return { name: p.slice(0, idx).trim(), value: p.slice(idx + 1).trim() }
    })
    .filter((c) => c.name.length > 0)
}

function getWindow(partitionKey: string): BrowserWindow {
  let win = windows.get(partitionKey)
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      partition: `persist:hidden-${partitionKey}`,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  windows.set(partitionKey, win)
  return win
}

export interface HiddenFetchRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** gRPC-Web 空請求（1 位元組旗標 + 4 位元組長度 0），沒有實際內容 */
  emptyGrpcBody?: boolean
  /** true：用 arrayBuffer 讀，轉成 base64 傳回（給二進位／protobuf 回應用） */
  binary?: boolean
}

export interface HiddenFetchResult {
  status: number
  ok: boolean
  text?: string
  base64?: string
  error?: string
}

export async function fetchViaHiddenBrowser(
  partitionKey: string,
  originUrl: string,
  cookieHeader: string,
  requests: HiddenFetchRequest[]
): Promise<HiddenFetchResult[]> {
  const win = getWindow(partitionKey)
  const ses = win.webContents.session
  const origin = new URL(originUrl)

  for (const c of parseCookieHeader(cookieHeader)) {
    try {
      await ses.cookies.set({
        url: origin.origin,
        name: c.name,
        value: c.value,
        domain: origin.hostname,
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'no_restriction'
      })
    } catch {
      /* 略過設不進去的 cookie */
    }
  }

  await win.loadURL(originUrl)

  const results: HiddenFetchResult[] = []
  for (const req of requests) {
    const bodyExpr = req.emptyGrpcBody
      ? 'new Uint8Array(5)'
      : req.body !== undefined
        ? JSON.stringify(req.body)
        : undefined
    const script = `
      (async () => {
        try {
          const res = await fetch(${JSON.stringify(req.url)}, {
            method: ${JSON.stringify(req.method ?? 'GET')},
            headers: ${JSON.stringify(req.headers ?? {})},
            ${bodyExpr !== undefined ? `body: ${bodyExpr},` : ''}
            credentials: 'include'
          });
          ${
            req.binary
              ? `const buf = await res.arrayBuffer();
                 const bytes = new Uint8Array(buf);
                 let bin = '';
                 for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                 return { status: res.status, ok: res.ok, base64: btoa(bin) };`
              : `const text = await res.text();
                 return { status: res.status, ok: res.ok, text };`
          }
        } catch (e) {
          return { status: 0, ok: false, error: String((e && e.message) || e) };
        }
      })()
    `
    try {
      const result = (await win.webContents.executeJavaScript(script)) as HiddenFetchResult
      results.push(result)
    } catch (e) {
      results.push({ status: 0, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
