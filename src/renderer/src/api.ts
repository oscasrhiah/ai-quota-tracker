export interface UsageWindowDTO {
  id: string
  label: string
  remainingPct: number | null
  resetsAtMs: number | null
  detail: string
}

export interface ProviderCacheDTO {
  ok: boolean
  error: string | null
  fetchedAtMs: number | null
  windows: UsageWindowDTO[]
  fields: string[]
  orgId?: string
  source?: string
  tried?: { url: string; method: string; status: number | string }[]
}

export interface ProviderTypeDTO {
  id: string
  name: string
  site: string
  color: string
}

export interface ConnectionStatusDTO {
  providerType: string
  label: string
  connected: boolean
  endpoint: string
  cache: ProviderCacheDTO | null
}

export interface AddConnectionResult {
  id: string | null
  cache: ProviderCacheDTO
}

export interface ConnectionSecretDTO {
  cookie: string
  endpoint: string
}

export interface ExportResult {
  ok: boolean
  error?: string
  filePath?: string
}

export interface ImportResult {
  ok: boolean
  error?: string
  id?: string
  providerType?: string
  label?: string
  endpoint?: string
  cache?: ProviderCacheDTO
}

export interface GoogleLoginResult {
  ok: boolean
  token?: string
  email?: string
  error?: string
}

export interface MiniItem {
  id: string
  label: string
  color: string
  pct: number
  resetsAtMs: number | null
}

export interface MiniPayload {
  tooltip: string
  hint: string
  items: MiniItem[]
}

export interface RendererApi {
  getStore: () => Promise<unknown>
  setStore: (data: unknown) => Promise<boolean>
  providerTypesList: () => Promise<ProviderTypeDTO[]>
  connectionsList: () => Promise<Record<string, ConnectionStatusDTO>>
  connectionAdd: (providerType: string, label: string, cookie: string, endpoint?: string) => Promise<AddConnectionResult>
  connectionUpdate: (id: string, patch: { label?: string; cookie?: string; endpoint?: string }) => Promise<ProviderCacheDTO>
  connectionRemove: (id: string) => Promise<boolean>
  connectionRefresh: (id: string) => Promise<ProviderCacheDTO>
  connectionRefreshAll: () => Promise<Record<string, ProviderCacheDTO>>
  connectionGetSecret: (id: string) => Promise<ConnectionSecretDTO | null>
  connectionRename: (id: string, label: string) => Promise<boolean>
  connectionExport: (id: string) => Promise<ExportResult>
  connectionImport: () => Promise<ImportResult>
  oauthGoogleLogin: () => Promise<GoogleLoginResult>
  updateTray: (p: MiniPayload) => void
  quitApp: () => void
  getAppVersion: () => Promise<string>
  getAutoLaunch: () => Promise<boolean>
  setAutoLaunch: (enable: boolean) => Promise<boolean>
  restoreMain: () => void
  onMiniData: (cb: (data: MiniPayload) => void) => () => void
}

declare global {
  interface Window {
    api?: RendererApi
  }
}

export const api: RendererApi | undefined = window.api
