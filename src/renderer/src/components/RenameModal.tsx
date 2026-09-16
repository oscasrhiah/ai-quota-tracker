import { useState } from 'react'
import { api } from '../api'

interface Props {
  connId: string
  initialLabel: string
  onDone: (label: string) => void
  onClose: () => void
}

export default function RenameModal({ connId, initialLabel, onDone, onClose }: Props) {
  const [label, setLabel] = useState(initialLabel)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    const trimmed = label.trim()
    if (!trimmed) {
      setError('名稱不能空白')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const ok = await api?.connectionRename(connId, trimmed)
      if (ok) {
        onDone(trimmed)
      } else {
        setError('改名失敗')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <h2>重新命名</h2>
        <label>
          顯示名稱
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            取消
          </button>
          <button onClick={() => void save()} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
