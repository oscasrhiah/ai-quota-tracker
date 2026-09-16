import { createServer } from 'node:http'
import { shell } from 'electron'

/**
 * Antigravity（Google 的 Cloud Code API）走正規 Google OAuth「已安裝應用程式」流程，
 * 不是貼 Cookie。這組 client_id／client_secret 是 Google 對「已安裝應用程式」型 OAuth
 * client 的公開識別碼（不是真正機密，Google 官方文件本身就這樣定義這類 client），
 * 抄自公開的 antigravity-usage 社群工具，跟它一樣的做法。
 */
const OAUTH_CONFIG = {
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  clientSecret: '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',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email']
}

function generateState(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        server.close(() => resolve(port))
      } else {
        reject(new Error('無法取得可用埠號'))
      }
    })
    server.on('error', reject)
  })
}

export interface GoogleOAuthResult {
  refreshToken: string
  accessToken: string
  expiresAt: number
  email?: string
}

/** 開瀏覽器讓使用者用 Google 帳號登入，等待本機回呼，換成 refresh token */
export async function runGoogleOAuthFlow(): Promise<GoogleOAuthResult> {
  const port = await getAvailablePort()
  const redirectUri = `http://127.0.0.1:${port}/callback`
  const state = generateState()

  const authParams = new URLSearchParams({
    client_id: OAUTH_CONFIG.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_CONFIG.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  })
  const authUrl = `${OAUTH_CONFIG.authUrl}?${authParams.toString()}`

  return new Promise((resolve, reject) => {
    let settled = false

    const server = createServer((req, res) => {
      if (settled) return
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      const errorParam = url.searchParams.get('error')

      const finish = (action: () => void, html: string, status = 200): void => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
        settled = true
        server.close()
        action()
      }

      if (errorParam) {
        finish(() => reject(new Error(`Google 登入失敗：${errorParam}`)), '<h1>登入失敗</h1><p>可以關閉這個分頁。</p>', 400)
        return
      }
      if (!code || returnedState !== state) {
        finish(() => reject(new Error('回呼網址缺少 code 或 state 不符')), '<h1>無效的回呼</h1>', 400)
        return
      }

      void (async () => {
        try {
          const tokenRes = await fetch(OAUTH_CONFIG.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: OAUTH_CONFIG.clientId,
              client_secret: OAUTH_CONFIG.clientSecret,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code'
            }).toString()
          })
          if (!tokenRes.ok) throw new Error(`交換 token 失敗（HTTP ${tokenRes.status}）`)
          const tokenData = (await tokenRes.json()) as {
            access_token: string
            refresh_token?: string
            expires_in: number
          }
          if (!tokenData.refresh_token) {
            throw new Error('沒有拿到 refresh token，請先到 myaccount.google.com/permissions 移除舊授權後再試一次')
          }

          let email: string | undefined
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${tokenData.access_token}` }
            })
            if (userRes.ok) email = ((await userRes.json()) as { email?: string }).email
          } catch {
            /* email 只是方便顯示用，拿不到不影響連線 */
          }

          finish(
            () =>
              resolve({
                refreshToken: tokenData.refresh_token as string,
                accessToken: tokenData.access_token,
                expiresAt: Date.now() + tokenData.expires_in * 1000,
                email
              }),
            `<html><body style="font-family:system-ui;padding:40px;text-align:center"><h1>登入成功！</h1><p>${
              email ? `已登入 ${email}。` : ''
            }可以關閉這個分頁，回到 App。</p></body></html>`
          )
        } catch (e) {
          finish(() => reject(e instanceof Error ? e : new Error(String(e))), '<h1>登入失敗</h1>', 500)
        }
      })()
    })

    server.listen(port, '127.0.0.1', () => {
      shell.openExternal(authUrl).catch(() => {
        /* 開不了瀏覽器就算了，使用者仍可從記錄的網址手動打開（目前沒有額外顯示 UI） */
      })
    })

    setTimeout(() => {
      if (!settled) {
        settled = true
        server.close()
        reject(new Error('登入逾時（2 分鐘內沒有完成）'))
      }
    }, 120000)
  })
}

/** 用 refresh token 換一個新的 access token（每次抓用量前都要呼叫，access token 很快過期） */
export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
      grant_type: 'refresh_token'
    }).toString()
  })
  if (!res.ok) throw new Error(`更新 token 失敗（HTTP ${res.status}）`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
}
