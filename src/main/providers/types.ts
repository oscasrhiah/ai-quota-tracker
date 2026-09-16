export interface FetchProvider {
  id: string
  name: string
  site: string
  color: string
  /**
   * endpoint：自訂端點（路徑或完整網址）；對需要「組織 ID」而非端點的服務（如 Claude），
   * 同一個參數借來放已知的組織 ID。
   */
  fetch: (cookie: string, endpoint?: string) => Promise<ProviderResult>
}

export interface ProviderResult {
  snapshot: ProviderSnapshot
  source: string
  tried: EndpointTry[]
  /** 部分服務（如 Claude）需要記住探索到的組織 ID，供下次直接使用 */
  orgId?: string
}

export interface EndpointTry {
  url: string
  method: string
  status: number | string
}

export interface UsageWindow {
  id: string
  label: string
  remainingPct: number | null
  resetsAtMs: number | null
  detail: string
}

export interface ProviderSnapshot {
  windows: UsageWindow[]
  fields: string[]
  orgId?: string
  source?: string
  tried?: EndpointTry[]
}

export class SessionExpiredError extends Error {
  constructor(provider: string) {
    super(`${provider} 登入已過期，請重新連接`)
    this.name = 'SessionExpiredError'
  }
}
