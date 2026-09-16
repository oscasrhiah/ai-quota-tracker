import { SessionExpiredError, FetchProvider, ProviderResult, UsageWindow } from './types'
import { refreshGoogleAccessToken } from '../googleOAuth'

/**
 * Antigravity（Google 的 Cloud Code API，cloudcode-pa.googleapis.com）用量：
 * 邏輯照抄自公開的 antigravity-usage CLI 工具的「google」模式。
 * 這裡不是貼 Cookie，是走正規 Google OAuth（見 ../googleOAuth.ts），
 * 連線時存的是 OAuth refresh token（包在一段 JSON 裡），不是 HTTP Cookie。
 */

const BASE = 'https://cloudcode-pa.googleapis.com'
const UA = 'antigravity'
const METADATA = { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' }

export interface StoredAntigravityAuth {
  refreshToken: string
  email?: string
}

interface LoadCodeAssistResponse {
  planInfo?: { monthlyPromptCredits?: number; planType?: string }
  availablePromptCredits?: number
  cloudaicompanionProject?: string | { id?: string }
}

interface ModelInfo {
  displayName?: string
  quotaInfo?: { remainingFraction?: number; resetTime?: string; isExhausted?: boolean }
}

interface FetchAvailableModelsResponse {
  models?: Record<string, ModelInfo>
}

function extractProjectId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return undefined
}

async function callCloudCode<T>(accessToken: string, endpoint: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    })
  } catch (e) {
    throw new Error(`連線失敗：${e instanceof Error ? e.message : String(e)}`)
  }
  if (res.status === 401 || res.status === 403) throw new SessionExpiredError('Antigravity')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Antigravity API 失敗（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

async function fetchAntigravity(storedJson: string): Promise<ProviderResult> {
  let stored: StoredAntigravityAuth
  try {
    stored = JSON.parse(storedJson)
  } catch {
    throw new Error('尚未設定 Antigravity 連線，請用「使用 Google 帳號登入」重新連接')
  }
  if (!stored?.refreshToken) {
    throw new Error('尚未設定 Antigravity 連線，請用「使用 Google 帳號登入」重新連接')
  }

  let accessToken: string
  try {
    accessToken = (await refreshGoogleAccessToken(stored.refreshToken)).accessToken
  } catch {
    throw new SessionExpiredError('Antigravity')
  }

  const codeAssist = await callCloudCode<LoadCodeAssistResponse>(accessToken, '/v1internal:loadCodeAssist', {
    metadata: METADATA
  })
  const projectId = extractProjectId(codeAssist.cloudaicompanionProject)

  let modelsResp: FetchAvailableModelsResponse = {}
  try {
    modelsResp = await callCloudCode<FetchAvailableModelsResponse>(
      accessToken,
      '/v1internal:fetchAvailableModels',
      projectId ? { project: projectId } : {}
    )
  } catch {
    /* 有些帳號沒權限拿模型清單，只顯示 prompt credits 就好 */
  }

  const windows: UsageWindow[] = []

  const monthly = codeAssist.planInfo?.monthlyPromptCredits
  const available = codeAssist.availablePromptCredits
  if (typeof monthly === 'number' && monthly > 0 && typeof available === 'number') {
    windows.push({
      id: 'antigravity-credits',
      label: '月度額度',
      remainingPct: Math.round((available / monthly) * 1000) / 10,
      resetsAtMs: null,
      detail: `${available} / ${monthly} credits`
    })
  }

  for (const [modelId, model] of Object.entries(modelsResp.models ?? {})) {
    const frac = model.quotaInfo?.remainingFraction
    if (typeof frac !== 'number') continue
    const resetMs = model.quotaInfo?.resetTime ? Date.parse(model.quotaInfo.resetTime) : NaN
    windows.push({
      id: `antigravity-model-${modelId}`,
      label: model.displayName || modelId,
      remainingPct: Math.round(frac * 1000) / 10,
      resetsAtMs: Number.isFinite(resetMs) ? resetMs : null,
      detail: modelId
    })
  }

  if (windows.length === 0) {
    throw new Error('沒解析出用量欄位（官方可能改版，或這個帳號沒有額度資訊）')
  }

  return { snapshot: { windows, fields: [] }, source: 'cloudcode-pa loadCodeAssist', tried: [] }
}

export function createAntigravityProvider(): FetchProvider {
  return {
    id: 'antigravity',
    name: 'Antigravity',
    site: 'antigravity.google',
    color: '#34a853',
    fetch: (storedJson: string) => fetchAntigravity(storedJson)
  }
}
