import { useEffect, useState } from 'react'
import { api } from '../api'
import { AppSettings } from '../types'

interface Props {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onToggleAutoLaunch: (enabled: boolean) => void
  onClose: () => void
}

export default function SettingsModal({ settings, onChange, onToggleAutoLaunch, onClose }: Props) {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    api?.getAppVersion().then(setVersion).catch(() => setVersion(null))
  }, [])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>
        <label>
          <input
            type="checkbox"
            checked={settings.autoLaunch}
            onChange={(e) => onToggleAutoLaunch(e.target.checked)}
          />
          開機自動啟動
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.notifyOnReset}
            onChange={(e) => onChange({ ...settings, notifyOnReset: e.target.checked })}
          />
          用量過低時通知我（低於
          <input
            className="inline-num"
            type="number"
            min={1}
            max={90}
            value={settings.lowWarnPct}
            onChange={(e) =>
              onChange({ ...settings, lowWarnPct: Math.min(90, Math.max(1, Number(e.target.value) || 15)) })
            }
          />
          %）
        </label>
        <label>
          自動重新整理間隔（每
          <input
            className="inline-num"
            type="number"
            min={1}
            max={120}
            value={settings.refreshIntervalMin}
            onChange={(e) =>
              onChange({
                ...settings,
                refreshIntervalMin: Math.min(120, Math.max(1, Number(e.target.value) || 5))
              })
            }
          />
          分鐘）
        </label>
        <p className="meta version-line">目前版本：{version ?? '讀取中…'}</p>
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  )
}
