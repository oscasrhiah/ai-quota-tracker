import { useState } from 'react'
import { ProviderTypeDTO } from '../api'
import { stepsFor, methodSummary, endpointNeed } from '../providerGuides'

interface Props {
  providerTypes: ProviderTypeDTO[]
  onClose: () => void
}

export default function GuideModal({ providerTypes, onClose }: Props) {
  const [active, setActive] = useState(providerTypes[0]?.id ?? '')
  const type = providerTypes.find((t) => t.id === active) ?? providerTypes[0]

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>使用說明：如何連接每個訂閱的用量</h2>
        <div className="guide-tabs">
          {providerTypes.map((t) => (
            <button
              key={t.id}
              className={'guide-tab' + (t.id === active ? ' active' : '')}
              style={{ ['--accent' as string]: t.color }}
              onClick={() => setActive(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        {type && (
          <>
            <p className="meta">
              <strong>{type.name}</strong>（{type.site}）的連線方式：{methodSummary(type.id)}
              {endpointNeed(type.id) === 'required' && '（自訂端點為必填）'}
            </p>
            <ol className="steps">
              {stepsFor(type.id).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p className="meta">
              Cookie／端點只存在本機，只送往 {type.site} 官方伺服器。要開始連線，關掉這個視窗後按「即時用量」區塊裡的「＋
              新增供應商」。
            </p>
          </>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  )
}
