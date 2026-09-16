import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { Agent, setGlobalDispatcher } from 'undici'
import { SessionExpiredError } from './providers/types'
import { ProviderSnapshot } from './providers/normalize'
import { initializeDefaultProviders, getProvider, getAllProviders } from './providers/registry'
import { runGoogleOAuthFlow } from './googleOAuth'

// Google 帳號的回應常帶一大串 Set-Cookie，會超過 Node fetch 預設的 HTTP 標頭大小上限而整個連線失敗
// （症狀：fetch 丟出 "Headers Overflow Error"），這裡把上限調大，全部 provider 共用同一個 fetch 設定。
setGlobalDispatcher(new Agent({ headersTimeout: 20000, maxHeaderSize: 65536 }))

const STORE_FILE = 'quota-store.json'

interface Connection {
  providerType: string
  label: string
  cookie: string
  orgId?: string
  endpoint?: string
}
interface ProviderCache {
  ok: boolean
  error: string | null
  fetchedAtMs: number | null
  windows: ProviderSnapshot['windows']
  fields: string[]
  orgId?: string
  source?: string
  tried?: { url: string; method: string; status: number | string }[]
}
interface StoreShape {
  connections?: Record<string, Connection>
  cache?: Record<string, ProviderCache>
  [k: string]: unknown
}

/** 渲染端算好的摘要（托盤提示＋迷你小工具共用），避免主行程重算一次業務邏輯 */
interface MiniItem {
  id: string
  label: string
  color: string
  pct: number
  resetsAtMs: number | null
}
interface MiniPayload {
  tooltip: string
  hint: string
  items: MiniItem[]
}

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let lastMiniPayload: MiniPayload | null = null
const MINI_WIDTH = 248
const MINI_HEIGHT = 152

// ---------- 本地儲存（JSON，放在 userData；session Cookie 只存本機，只送往官方） ----------
function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

function readStore(): StoreShape {
  try {
    if (existsSync(storePath())) {
      const v: unknown = JSON.parse(readFileSync(storePath(), 'utf-8'))
      if (v && typeof v === 'object') return v as StoreShape
    }
  } catch (e) {
    console.error('read store failed', e)
  }
  return {}
}

function writeStore(data: StoreShape): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('write store failed', e)
  }
}

function genConnId(providerType: string): string {
  return `${providerType}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// ---------- Provider 抓取（透過 registry，新增服務類型不用動這裡） ----------
async function refreshConnection(connId: string, cookieOverride?: string): Promise<ProviderCache> {
  const store = readStore()
  const conn = store.connections?.[connId]
  if (!conn) {
    return { ok: false, error: '找不到這個連線', fetchedAtMs: null, windows: [], fields: [] }
  }
  const provider = getProvider(conn.providerType)
  if (!provider) {
    return { ok: false, error: '未知的服務類型', fetchedAtMs: null, windows: [], fields: [] }
  }
  const cookie = cookieOverride ?? conn.cookie
  try {
    // endpoint 參數對大部分服務是自訂端點；對 Claude 則借來放已探索到的組織 ID
    const r = await provider.fetch(cookie, conn.endpoint ?? conn.orgId)
    const cache: ProviderCache = {
      ok: true,
      error: null,
      fetchedAtMs: Date.now(),
      windows: r.snapshot.windows,
      fields: r.snapshot.fields,
      orgId: r.orgId,
      source: r.source,
      tried: r.tried
    }
    store.connections = {
      ...(store.connections ?? {}),
      [connId]: { ...conn, cookie, orgId: r.orgId ?? conn.orgId }
    }
    store.cache = { ...(store.cache ?? {}), [connId]: cache }
    writeStore(store)
    return cache
  } catch (e) {
    const expired = e instanceof SessionExpiredError
    const msg = e instanceof Error ? e.message : String(e)
    // session 過期就清掉舊快取，避免顯示過期數字
    const cache: ProviderCache = {
      ok: false,
      error: msg,
      fetchedAtMs: expired ? null : (store.cache?.[connId]?.fetchedAtMs ?? null),
      windows: expired ? [] : (store.cache?.[connId]?.windows ?? []),
      fields: store.cache?.[connId]?.fields ?? [],
      orgId: store.cache?.[connId]?.orgId,
      source: store.cache?.[connId]?.source,
      tried: store.cache?.[connId]?.tried
    }
    store.cache = { ...(store.cache ?? {}), [connId]: cache }
    writeStore(store)
    return cache
  }
}

// ---------- 路徑 ----------
function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'assets', 'tray.png')
    : join(app.getAppPath(), 'assets', 'tray.png')
}

function preloadPath(): string {
  for (const f of ['index.js', 'index.mjs']) {
    const p = join(__dirname, '../preload', f)
    if (existsSync(p)) return p
  }
  return join(__dirname, '../preload/index.js')
}

// ---------- 視窗 ----------
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    title: 'AI 額度追蹤器',
    autoHideMenuBar: true,
    icon: existsSync(iconPath()) ? iconPath() : undefined,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      // 縮小成迷你小工具時主視窗會被 hide()，Electron 預設會節流被隱藏視窗的計時器（省電），
      // 這會讓自動刷新的 setInterval 停住，導致小工具的數字不再更新。關掉節流讓它照樣跑。
      backgroundThrottling: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 關閉視窗 → 縮到托盤＋顯示右下角迷你小工具（不結束程式）
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      hideMainShowMini()
    }
  })

  // 按最小化 → 直接收成右下角迷你小工具，而不是縮進工作列（'minimize' 事件無法 preventDefault，改為讓它先縮，再立刻隱藏並換成小工具）
  mainWindow.on('minimize', () => {
    hideMainShowMini()
  })
}

// ---------- 迷你懸浮小工具（視窗縮小後顯示在螢幕右下角） ----------
function createMiniWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  miniWindow = new BrowserWindow({
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    x: Math.max(0, width - MINI_WIDTH - 16),
    y: Math.max(0, height - MINI_HEIGHT - 16),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) {
    miniWindow.loadURL(`${url}?mini=1`)
  } else {
    miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: '?mini=1' })
  }
  miniWindow.on('closed', () => {
    miniWindow = null
  })
  miniWindow.webContents.once('did-finish-load', () => {
    if (lastMiniPayload) miniWindow?.webContents.send('mini:data', lastMiniPayload)
  })
}

function showMain(): void {
  mainWindow?.show()
  mainWindow?.focus()
  miniWindow?.hide()
}

function hideMainShowMini(): void {
  mainWindow?.hide()
  const existed = !!miniWindow
  if (!miniWindow) createMiniWindow()
  miniWindow?.show()
  if (existed && lastMiniPayload) miniWindow?.webContents.send('mini:data', lastMiniPayload)
}

// ---------- 托盤 ----------
function buildTrayMenu(onShow: () => void, hint: string): Menu {
  return Menu.buildFromTemplate([
    { label: '顯示主視窗', click: onShow },
    { label: hint, enabled: false },
    { type: 'separator' },
    {
      label: '結束程式',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
}

function createTray(): void {
  const img = existsSync(iconPath())
    ? nativeImage.createFromPath(iconPath())
    : nativeImage.createEmpty()
  tray = new Tray(img)
  tray.setToolTip('AI 額度追蹤器')
  tray.setContextMenu(buildTrayMenu(showMain, '尚無資料'))
  tray.on('double-click', showMain)
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isVisible()) showMain()
  })
}

// ---------- 啟動 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMain()
  })

  initializeDefaultProviders()

  app.whenReady().then(() => {
    ipcMain.handle('store:get', () => {
      const { connections: _connections, cache: _cache, ...rest } = readStore()
      return rest
    })
    ipcMain.handle('store:set', (_e, data) => {
      // 禁止經由通用 store 蓋掉 connections／cache（那兩個走專用通道）
      const cur = readStore()
      const next = (data ?? {}) as StoreShape
      delete next.connections
      delete next.cache
      writeStore({ ...cur, ...next, connections: cur.connections, cache: cur.cache })
      return true
    })
    ipcMain.handle('providerTypes:list', () =>
      getAllProviders().map((p) => ({ id: p.id, name: p.name, site: p.site, color: p.color }))
    )
    ipcMain.handle('connections:list', () => {
      const s = readStore()
      const out: Record<
        string,
        { providerType: string; label: string; connected: boolean; endpoint: string; cache: ProviderCache | null }
      > = {}
      for (const [id, conn] of Object.entries(s.connections ?? {})) {
        out[id] = {
          providerType: conn.providerType,
          label: conn.label,
          connected: true,
          endpoint: conn.endpoint ?? '',
          cache: s.cache?.[id] ?? null
        }
      }
      return out
    })
    ipcMain.handle(
      'connections:add',
      async (_e, providerType: string, label: string, cookie: string, endpoint?: string) => {
        const c = String(cookie ?? '').trim()
        if (!c) return { id: null, cache: { ok: false, error: '請貼上 Cookie', fetchedAtMs: null, windows: [], fields: [] } }
        const id = genConnId(providerType)
        const store = readStore()
        store.connections = {
          ...(store.connections ?? {}),
          [id]: { providerType, label: label.trim() || providerType, cookie: c, endpoint: (endpoint ?? '').trim() }
        }
        writeStore(store)
        const cache = await refreshConnection(id)
        return { id, cache }
      }
    )
    ipcMain.handle(
      'connections:update',
      async (_e, id: string, patch: { label?: string; cookie?: string; endpoint?: string }) => {
        const store = readStore()
        const prev = store.connections?.[id]
        if (!prev) return { ok: false, error: '找不到這個連線', fetchedAtMs: null, windows: [], fields: [] }
        const next: Connection = {
          ...prev,
          label: patch.label !== undefined ? patch.label.trim() || prev.label : prev.label,
          endpoint: patch.endpoint !== undefined ? patch.endpoint.trim() : prev.endpoint
        }
        store.connections = { ...(store.connections ?? {}), [id]: next }
        writeStore(store)
        if (patch.cookie && patch.cookie.trim()) {
          return refreshConnection(id, patch.cookie.trim())
        }
        return refreshConnection(id)
      }
    )
    ipcMain.handle('oauth:google-login', async () => {
      try {
        const r = await runGoogleOAuthFlow()
        return { ok: true, token: JSON.stringify({ refreshToken: r.refreshToken, email: r.email }), email: r.email }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })
    ipcMain.handle('connections:getSecret', (_e, id: string) => {
      const conn = readStore().connections?.[id]
      if (!conn) return null
      return { cookie: conn.cookie, endpoint: conn.endpoint ?? '' }
    })
    ipcMain.handle('connections:rename', (_e, id: string, label: string) => {
      const store = readStore()
      const prev = store.connections?.[id]
      if (!prev) return false
      const trimmed = label.trim()
      if (!trimmed) return false
      store.connections = { ...(store.connections ?? {}), [id]: { ...prev, label: trimmed } }
      writeStore(store)
      return true
    })
    ipcMain.handle('connections:export', async (_e, id: string) => {
      const conn = readStore().connections?.[id]
      if (!conn) return { ok: false, error: '找不到這個連線' }
      if (!mainWindow) return { ok: false, error: '找不到主視窗' }
      const safeName = conn.label.replace(/[\\/:*?"<>|]/g, '_') || conn.providerType
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '匯出連線設定',
        defaultPath: `${safeName}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, error: '已取消' }
      const payload = {
        providerType: conn.providerType,
        label: conn.label,
        cookie: conn.cookie,
        endpoint: conn.endpoint ?? ''
      }
      try {
        writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
        return { ok: true, filePath: result.filePath }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })
    ipcMain.handle('connections:import', async () => {
      if (!mainWindow) return { ok: false, error: '找不到主視窗' }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '匯入連線設定',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: false, error: '已取消' }
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(result.filePaths[0], 'utf-8'))
      } catch {
        return { ok: false, error: '檔案格式錯誤，不是有效的 JSON' }
      }
      const p = (parsed ?? {}) as { providerType?: unknown; label?: unknown; cookie?: unknown; endpoint?: unknown }
      if (typeof p.providerType !== 'string' || typeof p.cookie !== 'string' || !p.cookie.trim()) {
        return { ok: false, error: '檔案內容缺少必要欄位（providerType／cookie）' }
      }
      if (!getProvider(p.providerType)) {
        return { ok: false, error: `不支援的服務類型：${p.providerType}` }
      }
      const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : p.providerType
      const endpoint = typeof p.endpoint === 'string' ? p.endpoint : ''
      const id = genConnId(p.providerType)
      const store = readStore()
      store.connections = {
        ...(store.connections ?? {}),
        [id]: { providerType: p.providerType, label, cookie: p.cookie, endpoint }
      }
      writeStore(store)
      const cache = await refreshConnection(id)
      return { ok: true, id, providerType: p.providerType, label, endpoint, cache }
    })
    ipcMain.handle('connections:remove', (_e, id: string) => {
      const store = readStore()
      if (store.connections) delete store.connections[id]
      if (store.cache) delete store.cache[id]
      writeStore(store)
      return true
    })
    ipcMain.handle('connections:refresh', (_e, id: string) => refreshConnection(id))
    ipcMain.handle('connections:refreshAll', async () => {
      const store = readStore()
      const out: Record<string, ProviderCache> = {}
      for (const id of Object.keys(store.connections ?? {})) {
        out[id] = await refreshConnection(id)
      }
      return out
    })
    ipcMain.on('tray:update', (_e, payload: MiniPayload) => {
      lastMiniPayload = payload
      tray?.setToolTip(payload.tooltip)
      tray?.setContextMenu(buildTrayMenu(showMain, payload.hint))
      miniWindow?.webContents.send('mini:data', payload)
    })
    ipcMain.on('mini:restore', () => showMain())
    ipcMain.on('app:quit', () => {
      isQuitting = true
      app.quit()
    })
    ipcMain.handle('app:version', () => app.getVersion())
    ipcMain.handle('autolaunch:get', () => app.getLoginItemSettings().openAtLogin)
    ipcMain.handle('autolaunch:set', (_e, enable: boolean) => {
      app.setLoginItemSettings({ openAtLogin: !!enable })
      return app.getLoginItemSettings().openAtLogin
    })

    createWindow()
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showMain()
    })
  })

  // Windows：視窗全關也不結束，留在托盤繼續追蹤
  app.on('window-all-closed', () => {
    /* 留在托盤，不 quit */
  })
}
