import { ProviderTypeDTO } from '../api'

interface Props {
  providerTypes: ProviderTypeDTO[]
  onPick: (type: ProviderTypeDTO) => void
  onClose: () => void
}

export default function AddProviderModal({ providerTypes, onPick, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>新增供應商連線</h2>
        <p className="meta">選擇要連接的服務。同一種服務可以新增多個連線（例如多個 ChatGPT 帳號）。</p>
        <div className="type-pick-list">
          {providerTypes.map((t) => (
            <button key={t.id} className="type-pick" style={{ ['--accent' as string]: t.color }} onClick={() => onPick(t)}>
              <span className="dot" />
              <span className="type-pick-name">{t.name}</span>
              <span className="type-pick-site">{t.site}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
