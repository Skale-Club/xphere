// src/lib/obs/alerts.ts
// O3: observability alerting. Sends messages + errors to Telegram and dedupes
// repeat notifications via the obs_alert_log table. Used by the obs-alerts cron.
//
// Config:
//   TELEGRAM_BOT_TOKEN     - Bot token from @BotFather.
//   TELEGRAM_ALERT_CHAT_ID - Target chat/channel/group id (e.g. -1001234567890).
// When either is unset, alerting is a no-op (telegramConfigured() === false).

import type { SupabaseClient } from '@supabase/supabase-js'

export type AlertSeverity = 'warning' | 'critical'

export interface Alert {
  /** Stable dedupe key (e.g. `cost:<org>:<yyyy-mm-dd>`). */
  key: string
  title: string
  severity: AlertSeverity
  fields?: Record<string, string | number>
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_ALERT_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID

export function telegramConfigured(): boolean {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_ALERT_CHAT_ID)
}

// ─── Pure evaluation helpers (unit-tested) ────────────────────────────────────

export function costSeverity(pct: number): AlertSeverity {
  return pct >= 100 ? 'critical' : 'warning'
}

/** True when cost has reached the alert threshold (>= 80% of cap). */
export function costBreached(costUsd: number, capUsd: number): boolean {
  if (capUsd <= 0) return false
  return (costUsd / capUsd) * 100 >= 80
}

/** True when the error rate over a window is concerning (enough volume + ratio). */
export function errorRateBreached(total: number, errors: number, minVolume = 20, ratio = 0.25): boolean {
  if (total < minVolume) return false
  return errors / total >= ratio
}

// ─── Telegram delivery ─────────────────────────────────────────────────────────

export async function sendTelegramAlert(alert: Alert): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ALERT_CHAT_ID) return false
  const icon = alert.severity === 'critical' ? '🔴' : '🟠'
  const lines = [`${icon} *${alert.title}*`]
  for (const [k, v] of Object.entries(alert.fields ?? {})) lines.push(`• ${k}: ${v}`)
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_ALERT_CHAT_ID,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Dedupe (obs_alert_log) ───────────────────────────────────────────────────
// `supabase` is the service-role client. Typed loosely so this works without
// adding obs_alert_log to the generated Database types.

export async function alreadyAlerted(
  supabase: SupabaseClient,
  key: string,
  windowMinutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()
  const { data } = await supabase
    .from('obs_alert_log')
    .select('id')
    .eq('alert_key', key)
    .gte('sent_at', since)
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

export async function recordAlert(supabase: SupabaseClient, key: string): Promise<void> {
  await supabase.from('obs_alert_log').insert({ alert_key: key })
}
