export interface UsageWindow {
  id: string
  label: string
  /** 剩餘百分比 0-100；解析不出來時為 null */
  remainingPct: number | null
  /** 重置時間戳（ms）；未知時為 null */
  resetsAtMs: number | null
  /** 原始欄位摘要，方便除錯 */
  detail: string
}

export interface ProviderSnapshot {
  windows: UsageWindow[]
  /** 回應頂層欄位名稱（除錯用） */
  fields: string[]
}

const RESET_RE = /reset|expir|ttl|replenish|reset_at/i
const RESET_ABS_RE = /^reset_at$|^resets_at$|^reset_time$/i
const RELATIVE_RE = /_in$|_after$|ttl|expires_in|in_seconds|reset_after/i
const LIMIT_RE = /limit|cap\b|quota|allowance|total|max/i
const REMAIN_RE = /remain|left|available/i
const USED_RE = /utili|^used|^usage$/i
const PCT_RE = /percent/i
const WINDOW_SEC_RE = /window.*sec|period.*sec|interval.*sec/i

/** 依視窗長度（秒）猜一個好懂的中文標籤；猜不出來就退回路徑推導的標籤 */
function windowLabel(seconds: number | null, fallback: string): string {
  if (seconds !== null && seconds > 0) {
    if (Math.abs(seconds - 604800) <= 3600) return '每週額度'
    const hours = seconds / 3600
    if (Math.abs(hours - 24) <= 1) return '每日額度'
    if (hours < 20) {
      const h = Math.round(hours)
      return `${h} 小時額度`
    }
    const days = seconds / 86400
    if (days >= 27 && days <= 32) return '每月額度'
    if (days >= 1) return `${Math.round(days)} 天額度`
  }
  return fallback
}

/** 官方回應的欄位名稱多半是英文，這裡把常見字詞翻成中文，避免退回路徑標籤時漏出英文 */
const WORD_DICT: Record<string, string> = {
  five: '5',
  seven: '7',
  thirty: '30',
  hour: '小時',
  hours: '小時',
  day: '天',
  days: '天',
  daily: '每日',
  weekly: '每週',
  week: '週',
  month: '月',
  months: '月',
  monthly: '每月',
  session: '工作階段',
  usage: '用量',
  limit: '額度',
  limits: '額度',
  quota: '額度',
  quotas: '額度',
  rate: '速率',
  organization: '組織',
  organizations: '組織',
  org: '組織',
  utilization: '使用率',
  used: '已用',
  remaining: '剩餘',
  remain: '剩餘',
  left: '剩餘',
  available: '可用',
  total: '總量',
  max: '上限',
  cap: '上限',
  reset: '重置',
  resets: '重置',
  window: '視窗',
  windows: '視窗',
  period: '週期',
  account: '帳號',
  accounts: '帳號',
  user: '使用者',
  users: '使用者',
  plan: '方案',
  model: '模型',
  models: '模型',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  gpt: 'GPT',
  message: '訊息',
  messages: '訊息',
  token: 'Token',
  tokens: 'Token',
  primary: '主要',
  secondary: '次要',
  conversation: '對話',
  conversations: '對話',
  chat: '對話',
  allowance: '額度',
  apps: '應用',
  app: '應用',
  oauth: 'OAuth',
  api: 'API',
  check: '檢查',
  data: '資料',
  info: '資訊',
  detail: '詳情',
  details: '詳情',
  current: '目前',
  bard: 'Gemini',
  gemini: 'Gemini',
  chatui: '對話介面'
}

function translateWord(w: string): string {
  const lower = w.toLowerCase()
  return WORD_DICT[lower] ?? w
}

function prettifyGroup(segment: string): string {
  return segment
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map(translateWord)
    .join('')
}

function toMs(v: unknown, key: string): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12) return v // ms
    if (v > 1e9) return v * 1000 // 秒時間戳
    if (v > 0 && RELATIVE_RE.test(key)) return Date.now() + v * 1000 // 相對秒數
    return null
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v)
    if (Number.isFinite(t)) return t
    const n = Number(v)
    if (Number.isFinite(n)) return toMs(n, key)
  }
  return null
}

function numKeys(node: Record<string, unknown>): string[] {
  return Object.keys(node).filter((k) => typeof node[k] === 'number')
}

function prettify(path: string): string {
  const parts = path
    .replace(/\[[^\]]*\]/g, ' ')
    .split('.')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\d+$/.test(s))
    .map(prettifyGroup)
    .filter((s) => s.length > 0)
  const tail = parts.slice(-2).join(' · ')
  return tail || path
}

function summarize(node: Record<string, unknown>): string {
  return Object.keys(node)
    .filter((k) => ['string', 'number', 'boolean'].includes(typeof node[k]))
    .slice(0, 4)
    .map((k) => `${k}=${String(node[k])}`)
    .join(', ')
}

function extract(node: unknown, path: string, out: UsageWindow[], depth: number): void {
  if (node === null || node === undefined || depth > 6) return
  if (typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((v, i) => extract(v, `${path}[${i}]`, out, depth + 1))
    return
  }
  const rec = node as Record<string, unknown>
  const keys = Object.keys(rec)
  const resetKey = keys.find((k) => RESET_ABS_RE.test(k)) ?? keys.find((k) => RESET_RE.test(k))
  const nums = numKeys(rec)

  if (resetKey && nums.length > 0 && keys.length <= 12) {
    const resetsAt = toMs(rec[resetKey], resetKey)
    let remaining: number | null = null
    const limKey = keys.find((k) => LIMIT_RE.test(k) && typeof rec[k] === 'number')
    const remKey = keys.find((k) => REMAIN_RE.test(k) && typeof rec[k] === 'number')
    const usedKey = keys.find((k) => USED_RE.test(k) && typeof rec[k] === 'number')
    const pctKey = keys.find((k) => PCT_RE.test(k) && typeof rec[k] === 'number')
    const winKey = keys.find((k) => WINDOW_SEC_RE.test(k) && typeof rec[k] === 'number')
    const lim = limKey ? (rec[limKey] as number) : null
    const rem = remKey ? (rec[remKey] as number) : null
    const used = usedKey ? (rec[usedKey] as number) : null
    const pct = pctKey ? (rec[pctKey] as number) : null
    const winSeconds = winKey ? (rec[winKey] as number) : null

    if (rem !== null && lim !== null && lim > 0) remaining = (rem / lim) * 100
    else if (pct !== null) remaining = /remain|left/i.test(pctKey as string) ? pct : 100 - pct
    else if (used !== null && lim !== null && lim > 0) remaining = ((lim - used) / lim) * 100
    else if (used !== null && lim === null && used >= 0 && used <= 100) remaining = 100 - used

    if (remaining === null) {
      // 算不出剩餘百分比就不是用量視窗（例如 sentinel 驗證 blob），繼續往下找
    } else {
      out.push({
        id: path,
        label: windowLabel(winSeconds, prettify(path)),
        remainingPct: Math.max(0, Math.min(100, Math.round(remaining * 10) / 10)),
        resetsAtMs: resetsAt,
        detail: summarize(rec)
      })
      return // 此物件已收錄，不再往下鑽
    }
  }
  for (const k of keys) {
    if (k.startsWith('_')) continue
    extract(rec[k], path ? `${path}.${k}` : k, out, depth + 1)
  }
}

/** 把官方內部端點回傳的 JSON 轉成用量視窗列表（端點格式常變，採寬鬆解析） */
export function normalizeUsage(data: unknown): ProviderSnapshot {
  const out: UsageWindow[] = []
  extract(data, '', out, 0)
  const seen = new Set<string>()
  const deduped = out.filter((w) => {
    if (seen.has(w.id)) return false
    seen.add(w.id)
    return true
  })
  // 同一組（剩餘 %, 重置時間）只留標籤最清楚的一個（去掉重複解析的子物件）
  const best = new Map<string, UsageWindow>()
  for (const w of deduped) {
    const k = `${w.remainingPct}|${w.resetsAtMs ?? 'x'}`
    const prev = best.get(k)
    if (!prev || w.label.length > prev.label.length) best.set(k, w)
  }
  const windows = [...best.values()].slice(0, 15)
  const fields =
    data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data as Record<string, unknown>) : []
  return { windows, fields }
}
