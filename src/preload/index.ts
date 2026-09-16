import { contextBridge, ipcRenderer } from 'electron'

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

contextBridge.exposeInMainWorld('api', {
  getStore: () => ipcRenderer.invoke('store:get'),
  setStore: (data: unknown) => ipcRenderer.invoke('store:set', data),
  providerTypesList: (): Promise<ProviderTypeDTO[]> => ipcRenderer.invoke('providerTypes:list'),
  connectionsList: (): Promise<Record<string, ConnectionStatusDTO>> => ipcRenderer.invoke('connections:list'),
  connectionAdd: (providerType: string, label: string, cookie: string, endpoint?: string): Promise<AddConnectionResult> =>
    ipcRenderer.invoke('connections:add', providerType, label, cookie, endpoint),
  connectionUpdate: (id: string, patch: { label?: string; cookie?: string; endpoint?: string }): Promise<ProviderCacheDTO> =>
    ipcRenderer.invoke('connections:update', id, patch),
  connectionRemove: (id: string): Promise<boolean> => ipcRenderer.invoke('connections:remove', id),
  connectionRefresh: (id: string): Promise<ProviderCacheDTO> => ipcRenderer.invoke('connections:refresh', id),
  connectionRefreshAll: (): Promise<Record<string, ProviderCacheDTO>> => ipcRenderer.invoke('connections:refreshAll'),
  connectionGetSecret: (id: string): Promise<ConnectionSecretDTO | null> => ipcRenderer.invoke('connections:getSecret', id),
  connectionRename: (id: string, label: string): Promise<boolean> => ipcRenderer.invoke('connections:rename', id, label),
  connectionExport: (id: string): Promise<ExportResult> => ipcRenderer.invoke('connections:export', id),
  connectionImport: (): Promise<ImportResult> => ipcRenderer.invoke('connections:import'),
  oauthGoogleLogin: (): Promise<GoogleLoginResult> => ipcRenderer.invoke('oauth:google-login'),
  updateTray: (payload: MiniPayload) => ipcRenderer.send('tray:update', payload),
  quitApp: () => ipcRenderer.send('app:quit'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getAutoLaunch: () => ipcRenderer.invoke('autolaunch:get'),
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('autolaunch:set', enable),
  restoreMain: () => ipcRenderer.send('mini:restore'),
  onMiniData: (cb: (data: MiniPayload) => void) => {
    const listener = (_e: unknown, data: MiniPayload): void => cb(data)
    ipcRenderer.on('mini:data', listener)
    return () => ipcRenderer.removeListener('mini:data', listener)
  }
})
