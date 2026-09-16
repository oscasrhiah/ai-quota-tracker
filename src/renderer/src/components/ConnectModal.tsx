import { useEffect, useState } from 'react'
import { api, ProviderCacheDTO } from '../api'
import { stepsFor, endpointNeed } from '../providerGuides'

interface Props {
  mode: 'add' | 'edit'
  connId?: string
  providerType: string
  providerName: string
  site: string
  initialLabel: string
  initialEndpoint: string
  onDone: (result: { id: string; cache: ProviderCacheDTO; label: string; endpoint: string }) => void
  onClose: () => void
}

export default function ConnectModal({
  mode,
  connId,
  providerType,
  providerName,
  site,
  initialLabel,
  initialEndpoint,
  onDone,
  onClose
}: Props) {
  const isOAuth = providerType === 'antigravity'
  const [label, setLabel] = useState(initialLabel)
  const [cookie, setCookie] = useState('')
  const [endpoint, setEndpoint] = useState(initialEndpoint)
  const [loadingSecret, setLoadingSecret] = useState(mode === 'edit')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const need = endpointNeed(providerType)

  const [oauthToken, setOauthToken] = useState<string | null>(null)
  const [oauthEmail, setOauthEmail] = useState<string | null>(null)
  const [oauthLoading, setOauthLoading] = useState(false)

  // 編輯模式：載入目前存的 Cookie／端點（OAuth 服務則解析出目前登入的帳號 email 顯示）
  useEffect(() => {
    if (mode !== 'edit' || !connId) return
    ;(async () => {
      try {
        const secret = await api?.connectionGetSecret(connId)
        if (secret) {
          if (isOAuth) {
            try {
              const parsed = JSON.parse(secret.cookie) as { email?: string }
              setOauthEmail(parsed.email ?? null)
            } catch {
              /* 忽略 */
            }
          } else {
            setCookie(secret.cookie)
            setEndpoint(secret.endpoint)
          }
        }
      } finally {
        setLoadingSecret(false)
      }
    })()
  }, [mode, connId, isOAuth])

  const doGoogleLogin = async (): Promise<void> => {
    setOauthLoading(true)
    setResult(null)
    try {
      const r = await api?.oauthGoogleLogin()
      if (r?.ok && r.token) {
        setOauthToken(r.token)
        setOauthEmail(r.email ?? null)
      } else {
        setResult(`失敗：${r?.error ?? '登入失敗'}`)
      }
    } finally {
      setOauthLoading(false)
    }
  }

  const test = async (): Promise<void> => {
    if (isOAuth) {
      if (mode === 'add' && !oauthToken) {
        setResult('請先按上面的按鈕用 Google 帳號登入')
        return
      }
    } else if (mode === 'add' && !cookie.trim()) {
      setResult('請先貼上 Cookie')
      return
    }
    if (!isOAuth && need === 'required' && !endpoint.trim()) {
      setResult('這個服務沒有內建端點，請先貼上自訂端點網址')
      return
    }
    setTesting(true)
    setResult(null)
    try {
      const credential = isOAuth ? (oauthToken ?? '') : cookie.trim()
      if (mode === 'add') {
        const r = await api?.connectionAdd(providerType, label.trim() || providerName, credential, endpoint.trim())
        if (r?.id && r.cache.ok) {
          setResult(`連線成功！讀到 ${r.cache.windows.length} 個用量視窗。`)
          onDone({ id: r.id, cache: r.cache, label: label.trim() || providerName, endpoint: endpoint.trim() })
        } else {
          setResult(`失敗：${r?.cache.error ?? '未知錯誤'}`)
        }
      } else if (connId) {
        const cache = await api?.connectionUpdate(connId, {
          cookie: credential || undefined,
          endpoint: endpoint.trim()
        })
        if (cache?.ok) {
          setResult(`連線成功！讀到 ${cache.windows.length} 個用量視窗。`)
          onDone({ id: connId, cache, label: initialLabel, endpoint: endpoint.trim() })
        } else {
          setResult(`失敗：${cache?.error ?? '未知錯誤'}`)
        }
      }
    } catch (e) {
      setResult(`失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === 'add' ? `新增 ${providerName} 連線` : `重新連接「${initialLabel}」`}</h2>
        {mode === 'add' && (
          <label>
            顯示名稱（自己方便辨識用，例如「GPT － 個人帳號」）
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={providerName} />
          </label>
        )}
        <ol className="steps">
          {stepsFor(providerType).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>

        {isOAuth ? (
          <>
            <p className="meta">
              這是正規 Google OAuth 登入（不是貼 Cookie），授權資訊只存在你電腦本機，只送往 Google 官方伺服器。
            </p>
            {oauthEmail && <p className="meta">目前登入帳號：{oauthEmail}</p>}
            <div className="modal-actions" style={{ marginTop: 0, marginBottom: 12 }}>
              <span className="spacer" />
              <button onClick={() => void doGoogleLogin()} disabled={oauthLoading}>
                {oauthLoading ? '等待登入中…' : oauthEmail ? '重新登入 Google' : '使用 Google 帳號登入'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="meta">
              這串 Cookie 只存在你電腦本機（%APPDATA%\AI 額度追蹤器），請求只送往 {site}
              官方伺服器，不經任何第三方。登入過期（約數週一次）時回來重新貼上即可。
            </p>
            <label>
              Cookie（整串貼上{mode === 'edit' ? '；下面已顯示目前存的內容，沒過期可以不用改' : ''}）
              <textarea
                rows={4}
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder={loadingSecret ? '讀取目前設定中…' : 'Cookie: 後面的整串文字…'}
                disabled={loadingSecret}
              />
            </label>
            {providerType !== 'copilot' && (
              <label>
                {providerType === 'gemini'
                  ? '自訂 rpcid（選填：預設值失敗時才需要）'
                  : `自訂用量端點${need === 'required' ? '（必填：這個服務沒有內建端點）' : '（選填：自動探測失敗時才需要）'}`}
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  disabled={loadingSecret}
                  placeholder={
                    providerType === 'gemini'
                      ? '例如 jSf9Qc（開發者工具裡看到的 rpcid）'
                      : need === 'required'
                        ? '貼上開發者工具中找到的完整用量請求網址'
                        : '例如 /backend-api/conversation_limit（也可貼完整網址）'
                  }
                />
              </label>
            )}
          </>
        )}

        {result && <p className={result.startsWith('連線成功') || result.startsWith('已更新') ? 'ok' : 'error'}>{result}</p>}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            {result?.startsWith('連線成功') || result?.startsWith('已更新') ? '完成' : '取消'}
          </button>
          <button
            onClick={() => void test()}
            disabled={testing || loadingSecret || (isOAuth && mode === 'add' && !oauthToken)}
          >
            {testing ? '處理中…' : '測試連線並儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
