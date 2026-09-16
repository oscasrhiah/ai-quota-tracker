import { normalizeUsage } from '../src/main/providers/normalize.ts'

const claudeLike = {
  five_hour: { utilization: 73, resets_at: new Date(Date.now() + 2 * 3600_000).toISOString() },
  seven_day: { utilization: 41, resets_at: new Date(Date.now() + 4 * 86400_000).toISOString() },
  seven_day_sonnet: { utilization: 88, resets_at: new Date(Date.now() + 4 * 86400_000).toISOString() }
}

const chatgptLike = {
  message_cap: 80,
  limits: {
    gpt_5h: { remaining_messages: 12, message_cap: 80, reset_after: 3720 },
    codex_5h: { remaining: 45, limit: 100, resets_in: 1800 },
    weekly: { used_percent: 90, resets_at: new Date(Date.now() + 3 * 86400_000).toISOString() }
  }
}

const sentinelBlob = {
  persona: 'chatgpt-paid',
  token: 'gAAAAABq...',
  expire_after: 536,
  expire_at: new Date(Date.now() + 536_000).toISOString(),
  turnstile: { required: true },
  proofofwork: { required: true }
}

const claudeNested = {
  five_hour: { utilization: 36, resets_at: new Date(Date.now() + 2 * 3600_000).toISOString() },
  seven_day: { utilization: 20, resets_at: new Date(Date.now() + 4 * 86400_000).toISOString() },
  seven_day_oauth_apps: {
    utilization: 20,
    resets_at: new Date(Date.now() + 4 * 86400_000).toISOString(),
    limits: { utilization: 20, resets_at: new Date(Date.now() + 4 * 86400_000).toISOString() }
  },
  nimbus_quill: { enabled: true, weight: 50 }
}

for (const [name, payload] of Object.entries({ claudeLike, chatgptLike, sentinelBlob, claudeNested, empty: {}, garbage: { a: 1, b: 'x' } })) {  const snap = normalizeUsage(payload)
  console.log('=== ' + name + ' ===')
  console.log('fields:', JSON.stringify(snap.fields))
  for (const w of snap.windows) {
    console.log(`- ${w.label} | remaining=${w.remainingPct} | resetsAt=${w.resetsAtMs ? new Date(w.resetsAtMs).toISOString() : null} | ${w.detail}`)
  }
  if (snap.windows.length === 0) console.log('(no windows)')
}
