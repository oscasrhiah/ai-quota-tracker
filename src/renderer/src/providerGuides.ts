/** 每種服務類型的連線步驟；新增供應商精靈與「使用說明」視窗共用 */
export const PROVIDER_STEPS: Record<string, string[]> = {
  chatgpt: [
    '用 Chrome / Edge 開啟 chatgpt.com 並登入你的帳號',
    '按 F12 開啟開發者工具，切到「網路（Network）」頁籤',
    '重新整理頁面，在請求列表隨便點一個 chatgpt.com 的請求（哪一個都可以，不用找 backend-api）',
    '點開「標頭（Headers）」，複製「要求標頭」裡 Cookie: 後面的整串文字，貼到下方'
  ],
  claude: [
    '用 Chrome / Edge 開啟 claude.ai/settings/usage 並登入你的帳號',
    '按 F12 開啟開發者工具，切到「網路（Network）」頁籤',
    '重新整理頁面，找到名為 usage 的請求，點開「標頭（Headers）」',
    '複製「要求標頭」裡 Cookie: 後面的整串文字，貼到下方'
  ],
  gemini: [
    '手動輸入網址開啟 gemini.google.com 並登入你的帳號（不要用搜尋結果或別人給的連結，避免連到假冒網站）',
    '按 F12 開啟開發者工具，切到「網路（Network）」頁籤，隨便點一個請求，複製「要求標頭」裡 Cookie: 後面的整串文字，貼到下方',
    '本工具會自動去頁面裡找防 CSRF token、組出正確的用量請求，通常不用填自訂端點',
    '如果失敗，錯誤訊息會顯示原始回應內容；若你知道正確的 rpcid（開發者工具裡看到的），可以填到下方「自訂端點」覆蓋預設值'
  ],
  antigravity: [
    '按下方「使用 Google 帳號登入」，會開啟瀏覽器跳出 Google 官方登入畫面',
    '用你 Antigravity 登入的同一個 Google 帳號完成授權',
    '瀏覽器顯示「登入成功」後回到這裡，App 會自動記住授權（不是貼 Cookie，是正規 OAuth）',
    '授權會過期時，回來按「重新登入 Google」再走一次就好'
  ],
  grok: [
    '用 Chrome / Edge 開啟 grok.com 並登入你的帳號',
    '按 F12 開啟開發者工具，切到「網路（Network）」頁籤，隨便點一個 grok.com 的請求',
    '點開「標頭（Headers）」，複製「要求標頭」裡 Cookie: 後面的整串文字，貼到下方（不用填自訂端點）'
  ],
  copilot: [
    '用 Chrome / Edge 開啟 github.com/settings/billing/ai_usage 並登入你的帳號',
    '按 F12 開啟開發者工具，切到「網路（Network）」頁籤，隨便點一個 github.com 的請求',
    '複製「要求標頭」裡 Cookie: 後面的整串文字（從頭到尾整串，不要只選一部分），貼到下方（不用填自訂端點）'
  ]
}

export const PROVIDER_NEEDS_ENDPOINT: Record<string, 'optional' | 'required'> = {
  chatgpt: 'optional',
  claude: 'optional',
  gemini: 'optional',
  antigravity: 'optional',
  grok: 'optional',
  copilot: 'optional'
}

/** 每種服務實際的連線方式摘要；用在「使用說明」視窗，讓每個分頁反映真實差異而不是同一套話術 */
export const PROVIDER_METHOD_SUMMARY: Record<string, string> = {
  chatgpt: '只需要 Cookie。本工具內建一份已知端點清單會自動依序嘗試，通常不用手動找端點。',
  claude: '只需要 Cookie。本工具會自動找出你的組織 ID、呼叫官方的用量頁端點。',
  gemini: '只需要 Cookie。本工具會自動到頁面裡挖出防 CSRF token、組出正確的用量請求——這是三者中做法最特別、也最容易因為 Google 改版而失效的一種。',
  antigravity: '走正規 Google OAuth 登入（不是貼 Cookie），跟其他家做法不同——授權後直接呼叫 Google 官方的 Cloud Code API。',
  grok: '只需要 Cookie，端點是一般的 REST／gRPC-Web 請求，做法跟 ChatGPT／Claude 接近，相對穩定。',
  copilot: '只需要 Cookie。本工具直接讀取 ai_usage 頁面 HTML 裡的用量進度條文字，不用額外找端點。'
}

const FALLBACK_STEPS = [
  '用瀏覽器開啟該服務的網站並登入你的帳號',
  '按 F12 開啟開發者工具，切到「網路（Network）」頁籤',
  '找到會顯示用量／額度數字的請求，複製「要求標頭」裡 Cookie: 後面的文字',
  '把該請求的完整網址也貼到下方「自訂端點」'
]

export function stepsFor(providerType: string): string[] {
  return PROVIDER_STEPS[providerType] ?? FALLBACK_STEPS
}

export function endpointNeed(providerType: string): 'optional' | 'required' {
  return PROVIDER_NEEDS_ENDPOINT[providerType] ?? 'required'
}

export function methodSummary(providerType: string): string {
  return PROVIDER_METHOD_SUMMARY[providerType] ?? '沒有已知的公開用量端點，Cookie 加自訂端點網址都必填，需要自行在開發者工具找出來。'
}
