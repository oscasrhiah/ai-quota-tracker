import { ProviderCacheDTO } from '../api'
import { formatCountdown, formatDateTime, timeAgo } from '../time'

interface Props {
  id: string
  label: string
  color: string
  cache: ProviderCacheDTO | null
  refreshing: boolean
  exporting: boolean
  now: number
  onReconnect: (id: string) => void
  onRename: (id: string) => void
  onRemove: (id: string) => void
  onRefresh: (id: string) => void
  onExport: (id: string) => void
}

export default function ProviderCard({
  id,
  label,
  color,
  cache,
  refreshing,
  exporting,
  now,
  onReconnect,
  onRename,
  onRemove,
  onRefresh,
  onExport
}: Props) {
  const windows = cache?.windows ?? []

  return (
    <section className="card live" style={{ ['--accent' as string]: color }}>
      <header className="card-head">
        <span className="dot" />
        <h2>{label}</h2>
        <span className={'live-badge ' + (cache?.ok ? 'on' : cache ? 'err' : 'off')}>
          {cache?.ok ? '即時連線中' : cache ? '連線異常' : '尚未取得資料'}
        </span>
      </header>

      {cache && !cache.ok && (
        <p className="error">
          {cache.error ?? '讀取失敗'}
          {cache.windows.length > 0 && '（顯示上次成功資料）'}
        </p>
      )}

      {cache && windows.length > 0 && (
        <>
          <div className="window-list">
            {windows.map((w) => {
              const remain = w.remainingPct
              const used = remain !== null ? Math.max(0, Math.min(100, Math.round((100 - remain) * 10) / 10)) : null
              return (
                <div className="window-block" key={w.id}>
                  <div className="window-head">
                    <span className="w-name">{w.label}</span>
                    <span className="w-reset">
                      {w.resetsAtMs !== null
                        ? `${formatDateTime(w.resetsAtMs)} 重置（${formatCountdown(w.resetsAtMs - now)}後）`
                        : '重置時間未知'}
                    </span>
                  </div>
                  {used !== null && remain !== null ? (
                    <>
                      <div className="dualbar">
                        <div className="dualbar-used" style={{ width: `${used}%` }} />
                        <div className="dualbar-avail" style={{ width: `${remain}%` }} />
                      </div>
                      <div className="window-foot">
                        <span className="used-txt">已使用 {used}%</span>
                        <span className="avail-txt">可使用 {remain}%</span>
                      </div>
                    </>
                  ) : (
                    <p className="meta">無法解析百分比</p>
                  )}
                </div>
              )
            })}
          </div>
          <p className="meta">{cache.fetchedAtMs ? `上次更新：${timeAgo(cache.fetchedAtMs, now)}` : '尚未更新'}</p>
        </>
      )}

      {cache?.ok && windows.length === 0 && (
        <p className="meta">連線成功，但這次沒有解析出用量視窗（官方可能改版）。請按重新整理再試一次。</p>
      )}

      <div className="actions">
        <button onClick={() => onRefresh(id)} disabled={refreshing}>
          {refreshing ? '更新中…' : '重新整理'}
        </button>
        <button className="ghost" onClick={() => onReconnect(id)}>
          重新連接
        </button>
        <button className="ghost" onClick={() => onRename(id)}>
          重新命名
        </button>
        <button className="ghost" onClick={() => onExport(id)} disabled={exporting}>
          {exporting ? '匯出中…' : '匯出'}
        </button>
        <button className="ghost" onClick={() => onRemove(id)}>
          移除
        </button>
      </div>
    </section>
  )
}
