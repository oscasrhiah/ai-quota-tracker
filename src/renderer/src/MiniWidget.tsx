import { useEffect, useState, CSSProperties } from 'react'
import { api, MiniPayload } from './api'
import { formatCountdown } from './time'

const dragStyle = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const noDragStyle = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

const MAX_ITEMS = 8

/** 3 個以內單排；4 個以上拆兩排（上排無條件進位、下排補剩下的） */
function splitRows<T>(items: T[]): T[][] {
  const n = items.length
  if (n <= 3) return n > 0 ? [items] : []
  const row1 = Math.ceil(n / 2)
  return [items.slice(0, row1), items.slice(row1)]
}

export default function MiniWidget() {
  const [data, setData] = useState<MiniPayload | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    document.body.classList.add('mini-mode')
    return () => document.body.classList.remove('mini-mode')
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const off = api?.onMiniData((d) => setData(d))
    return () => off?.()
  }, [])

  const items = (data?.items ?? []).slice(0, MAX_ITEMS)
  const rows = splitRows(items)

  return (
    <div className="mini-widget" style={dragStyle} onDoubleClick={() => api?.restoreMain()}>
      <button className="mini-restore" style={noDragStyle} onClick={() => api?.restoreMain()} title="展開主視窗">
        ⤢
      </button>

      {items.length > 0 ? (
        <div className="mini-pies">
          {rows.map((row, ri) => (
            <div className="mini-pie-row" key={ri}>
              {row.map((it) => (
                <div
                  className="mini-pie-item"
                  key={it.id}
                  title={`${it.label}：剩 ${it.pct}%${it.resetsAtMs !== null ? ` · ${formatCountdown(it.resetsAtMs - now)}後重置` : ''}`}
                >
                  <div
                    className="mini-pie"
                    style={{
                      background: `conic-gradient(${it.color} 0% ${it.pct}%, #2b3850 ${it.pct}% 100%)`
                    }}
                  >
                    <div className="mini-pie-hole">{it.pct}</div>
                  </div>
                  <span className="mini-pie-label">{it.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="mini-empty">尚無資料，展開主視窗連接服務</p>
      )}
    </div>
  )
}
