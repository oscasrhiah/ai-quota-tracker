import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ConnectionStatusDTO, ProviderCacheDTO, ProviderTypeDTO } from './api'
import { AppSettings, PersistedState } from './types'
import { formatCountdown } from './time'
import ProviderCard from './components/ProviderCard'
import ConnectModal from './components/ConnectModal'
import AddProviderModal from './components/AddProviderModal'
import GuideModal from './components/GuideModal'
import RenameModal from './components/RenameModal'
import SettingsModal from './components/SettingsModal'

const DEFAULT_SETTINGS: AppSettings = {
  autoLaunch: false,
  notifyOnReset: true,
  lowWarnPct: 15,
  refreshIntervalMin: 5,
  connectionOrder: []
}
const MAX_MINI_ITEMS = 8

interface ConnectDraft {
  mode: 'add' | 'edit'
  id?: string
  providerType: string
  providerName: string
  site: string
  label: string
  endpoint: string
}

export default function App() {
  const [now, setNow] = useState(() => Date.now())
  const [connections, setConnections] = useState<Record<string, ConnectionStatusDTO> | null>(null)
  const [providerTypes, setProviderTypes] = useState<ProviderTypeDTO[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showAddPicker, setShowAddPicker] = useState(false)
  const [connecting, setConnecting] = useState<ConnectDraft | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({})
  const [exporting, setExporting] = useState<Record<string, boolean>>({})
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const loadedRef = useRef(false)
  const warnedRef = useRef<Set<string>>(new Set())
  const lastTrayRef = useRef('')
  const dragIdRef = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // 卡片顯示順序：先照使用者拖曳過的順序，新連線／尚未排過的接在後面
  const orderedIds = useMemo(() => {
    const known = Object.keys(connections ?? {})
    const saved = (settings.connectionOrder ?? []).filter((id) => known.includes(id))
    const missing = known.filter((id) => !saved.includes(id))
    return [...saved, ...missing]
  }, [connections, settings.connectionOrder])

  const reorder = (draggedId: string, targetId: string): void => {
    if (draggedId === targetId) return
    const current = orderedIds.slice()
    const from = current.indexOf(draggedId)
    const to = current.indexOf(targetId)
    if (from === -1 || to === -1) return
    current.splice(from, 1)
    current.splice(to, 0, draggedId)
    setSettings((s) => ({ ...s, connectionOrder: current }))
  }

  const typeMeta = (id: string): ProviderTypeDTO | undefined => providerTypes.find((t) => t.id === id)

  // 每秒時鐘
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  // 載入：供應商類型＋連線清單＋設定
  useEffect(() => {
    ;(async () => {
      try {
        setProviderTypes((await api?.providerTypesList()) ?? [])
      } catch {
        /* 忽略 */
      }
      try {
        setConnections((await api?.connectionsList()) ?? {})
      } catch {
        setConnections({})
      }
      let st = { ...DEFAULT_SETTINGS }
      try {
        const raw = (await api?.getStore()) as PersistedState | null
        if (raw?.settings) st = { ...st, ...raw.settings }
        const al = await api?.getAutoLaunch()
        if (typeof al === 'boolean') st.autoLaunch = al
      } catch {
        /* 用預設值 */
      }
      setSettings(st)
      loadedRef.current = true
    })()
  }, [])

  const doRefreshAll = async (silent: boolean): Promise<void> => {
    try {
      const out = await api?.connectionRefreshAll()
      if (out) {
        setConnections((prev) => {
          if (!prev) return prev
          const next = { ...prev }
          for (const [id, cache] of Object.entries(out)) {
            if (next[id]) next[id] = { ...next[id], cache }
          }
          return next
        })
      }
    } catch {
      if (!silent) {
        /* 手動按的失敗由按鈕狀態呈現，這裡不打擾 */
      }
    }
  }

  // 啟動後先刷一次真實數據，之後依設定的間隔自動刷（改設定會立刻套用新間隔）
  useEffect(() => {
    if (!loadedRef.current || !connections) return
    void doRefreshAll(true)
    const pollMs = Math.max(1, settings.refreshIntervalMin || 5) * 60 * 1000
    const t = window.setInterval(() => void doRefreshAll(true), pollMs)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections !== null, settings.refreshIntervalMin])

  // 存檔（設定；連線資料走專用通道，不在這裡）
  useEffect(() => {
    if (!loadedRef.current) return
    api?.setStore({ settings }).catch(() => undefined)
  }, [settings])

  // 即時用量過低警告（每個視窗每個週期只警告一次）
  useEffect(() => {
    if (!settings.notifyOnReset || !connections) return
    for (const [id, conn] of Object.entries(connections)) {
      const cache = conn.cache
      if (!cache?.ok) continue
      for (const w of cache.windows) {
        if (w.remainingPct === null) continue
        const key = `${id}:${w.id}:${w.resetsAtMs ?? 0}`
        if (w.remainingPct <= settings.lowWarnPct && !warnedRef.current.has(key)) {
          warnedRef.current.add(key)
          try {
            new Notification(`${conn.label} 用量偏低`, {
              body: `${w.label} 只剩 ${w.remainingPct}%${
                w.resetsAtMs ? `，${formatCountdown(w.resetsAtMs - Date.now())}後重置` : ''
              }`
            })
          } catch {
            /* 忽略 */
          }
        }
      }
    }
    if (warnedRef.current.size > 200) warnedRef.current.clear()
  }, [connections, settings.notifyOnReset, settings.lowWarnPct])

  // 每個連線最吃緊的視窗（托盤＋迷你小工具＋標題用），依剩餘 % 由低到高排序
  const topItems = useMemo(() => {
    const list: { id: string; label: string; color: string; pct: number; resetsAtMs: number | null }[] = []
    for (const [id, conn] of Object.entries(connections ?? {})) {
      let best: { pct: number; resetsAtMs: number | null } | null = null
      for (const w of conn.cache?.windows ?? []) {
        if (w.remainingPct === null) continue
        if (!best || w.remainingPct < best.pct) best = { pct: w.remainingPct, resetsAtMs: w.resetsAtMs }
      }
      if (best) list.push({ id, label: conn.label, color: typeMeta(conn.providerType)?.color ?? '#14b8a6', ...best })
    }
    list.sort((a, b) => a.pct - b.pct)
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, providerTypes])

  // 托盤＋迷你小工具：優先顯示真實數據
  useEffect(() => {
    if (!connections) return
    let tooltip = 'AI 額度追蹤器'
    let hint = '尚未連接任何供應商'
    if (topItems.length > 0) {
      const t = topItems[0]
      const cd = t.resetsAtMs !== null ? `（${formatCountdown(t.resetsAtMs - now)}後重置）` : ''
      tooltip = `AI 額度追蹤器｜${t.label} 剩 ${t.pct}%`
      hint = `${t.label} 剩 ${t.pct}%${cd}`
    } else if (Object.keys(connections).length > 0) {
      tooltip = 'AI 額度追蹤器｜連線更新中…'
      hint = '連線更新中…'
    }
    const key = `${tooltip}|${Math.floor(now / 10_000)}`
    if (key !== lastTrayRef.current) {
      lastTrayRef.current = key
      api?.updateTray({
        tooltip,
        hint,
        items: topItems.slice(0, MAX_MINI_ITEMS)
      })
    }
  }, [connections, topItems, now])

  const refreshOne = async (id: string): Promise<void> => {
    setRefreshing((r) => ({ ...r, [id]: true }))
    try {
      const cache = await api?.connectionRefresh(id)
      if (cache) setConnections((prev) => (prev && prev[id] ? { ...prev, [id]: { ...prev[id], cache } } : prev))
    } finally {
      setRefreshing((r) => ({ ...r, [id]: false }))
    }
  }

  const removeConnection = async (id: string): Promise<void> => {
    const label = connections?.[id]?.label ?? '這個連線'
    if (!window.confirm(`確定移除「${label}」？（本機存的 Cookie 會刪除）`)) return
    await api?.connectionRemove(id)
    setConnections((prev) => {
      if (!prev) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const openReconnect = (id: string): void => {
    const conn = connections?.[id]
    if (!conn) return
    const meta = typeMeta(conn.providerType)
    setConnecting({
      mode: 'edit',
      id,
      providerType: conn.providerType,
      providerName: meta?.name ?? conn.providerType,
      site: meta?.site ?? '',
      label: conn.label,
      endpoint: conn.endpoint
    })
  }

  const exportOne = async (id: string): Promise<void> => {
    setExporting((r) => ({ ...r, [id]: true }))
    try {
      const r = await api?.connectionExport(id)
      if (r && !r.ok && r.error !== '已取消') window.alert(`匯出失敗：${r.error}`)
    } finally {
      setExporting((r) => ({ ...r, [id]: false }))
    }
  }

  const importOne = async (): Promise<void> => {
    setImporting(true)
    setImportMsg(null)
    try {
      const r = await api?.connectionImport()
      if (r?.ok && r.id && r.cache) {
        setConnections((prev) => ({
          ...(prev ?? {}),
          [r.id as string]: {
            providerType: r.providerType ?? '',
            label: r.label ?? r.providerType ?? '',
            connected: true,
            endpoint: r.endpoint ?? '',
            cache: r.cache as ProviderCacheDTO
          }
        }))
        setImportMsg(`已匯入「${r.label}」`)
      } else if (r && r.error !== '已取消') {
        setImportMsg(`匯入失敗：${r.error}`)
      }
    } finally {
      setImporting(false)
    }
  }

  const onPickType = (t: ProviderTypeDTO): void => {
    setShowAddPicker(false)
    setConnecting({ mode: 'add', providerType: t.id, providerName: t.name, site: t.site, label: t.name, endpoint: '' })
  }

  const onConnectDone = (result: { id: string; cache: ProviderCacheDTO; label: string; endpoint: string }): void => {
    if (!connecting) return
    setConnections((prev) => ({
      ...(prev ?? {}),
      [result.id]: {
        providerType: connecting.providerType,
        label: result.label,
        connected: true,
        endpoint: result.endpoint,
        cache: result.cache
      }
    }))
  }

  const toggleAutoLaunch = async (v: boolean): Promise<void> => {
    try {
      const actual = await api?.setAutoLaunch(v)
      setSettings((s) => ({ ...s, autoLaunch: typeof actual === 'boolean' ? actual : v }))
    } catch {
      setSettings((s) => ({ ...s, autoLaunch: v }))
    }
  }

  if (!connections) {
    return (
      <div className="app">
        <p className="loading">載入中…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>AI 額度追蹤器</h1>
          <p className="subtitle">
            {topItems.length > 0 ? (
              <>
                最吃緊：<strong>{topItems[0].label}</strong> 剩 {topItems[0].pct}%
                {topItems[0].resetsAtMs !== null ? `（${formatCountdown(topItems[0].resetsAtMs - now)}後重置）` : ''}
              </>
            ) : (
              '按「＋ 新增供應商」連接你的第一個訂閱'
            )}
          </p>
        </div>
        <div className="top-actions">
          <button onClick={() => void doRefreshAll(false)}>重新整理</button>
          <button className="ghost" onClick={() => void importOne()} disabled={importing}>
            {importing ? '匯入中…' : '匯入連線'}
          </button>
          <button className="ghost" onClick={() => setShowGuide(true)}>
            使用說明
          </button>
          <button className="ghost" onClick={() => setShowSettings(true)}>
            設定
          </button>
          <button className="ghost" onClick={() => api?.quitApp()}>
            結束
          </button>
        </div>
      </header>

      {importMsg && <p className={importMsg.startsWith('已匯入') ? 'ok' : 'error'}>{importMsg}</p>}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onToggleAutoLaunch={(v) => void toggleAutoLaunch(v)}
          onClose={() => setShowSettings(false)}
        />
      )}

      <h3 className="section-title">即時用量（官方數據，卡片可拖曳調整順序）</h3>
      <main className="grid">
        {orderedIds.map((id) => {
          const conn = connections[id]
          if (!conn) return null
          return (
            <div
              key={id}
              className={'drag-wrap' + (dragOverId === id ? ' drag-over' : '')}
              draggable
              onDragStart={() => {
                dragIdRef.current = id
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragOverId !== id) setDragOverId(id)
              }}
              onDragLeave={() => setDragOverId((v) => (v === id ? null : v))}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverId(null)
                if (dragIdRef.current) reorder(dragIdRef.current, id)
                dragIdRef.current = null
              }}
              onDragEnd={() => {
                dragIdRef.current = null
                setDragOverId(null)
              }}
            >
              <ProviderCard
                id={id}
                label={conn.label}
                color={typeMeta(conn.providerType)?.color ?? '#14b8a6'}
                cache={conn.cache}
                refreshing={!!refreshing[id]}
                exporting={!!exporting[id]}
                now={now}
                onReconnect={openReconnect}
                onRename={(cid) => setRenamingId(cid)}
                onRemove={(cid) => void removeConnection(cid)}
                onRefresh={(cid) => void refreshOne(cid)}
                onExport={(cid) => void exportOne(cid)}
              />
            </div>
          )
        })}
        <button className="ghost add-card" onClick={() => setShowAddPicker(true)}>
          ＋ 新增供應商
        </button>
      </main>

      <footer className="hint">
        即時數據每 {settings.refreshIntervalMin} 分鐘自動更新（可到「設定」調整）；關閉視窗會縮到右下角托盤繼續顯示。登入資訊只存本機、只送往官方伺服器。
      </footer>

      {showGuide && <GuideModal providerTypes={providerTypes} onClose={() => setShowGuide(false)} />}

      {showAddPicker && (
        <AddProviderModal providerTypes={providerTypes} onPick={onPickType} onClose={() => setShowAddPicker(false)} />
      )}

      {connecting && (
        <ConnectModal
          mode={connecting.mode}
          connId={connecting.id}
          providerType={connecting.providerType}
          providerName={connecting.providerName}
          site={connecting.site}
          initialLabel={connecting.label}
          initialEndpoint={connecting.endpoint}
          onDone={(r) => {
            onConnectDone(r)
          }}
          onClose={() => setConnecting(null)}
        />
      )}

      {renamingId && connections[renamingId] && (
        <RenameModal
          connId={renamingId}
          initialLabel={connections[renamingId].label}
          onDone={(newLabel) => {
            setConnections((prev) =>
              prev && prev[renamingId] ? { ...prev, [renamingId]: { ...prev[renamingId], label: newLabel } } : prev
            )
            setRenamingId(null)
          }}
          onClose={() => setRenamingId(null)}
        />
      )}
    </div>
  )
}
