/**
 * Shared date-filter utilities for all Ads platform panels.
 * Used by AdsDateFilter component, Meta overview, and Google overview.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type DateFilter =
  | { type: 'preset'; value: string }
  | { type: 'custom'; since: string; until: string }

// ── Labels & preset lists ────────────────────────────────────────────────────

export const PRESET_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7d: 'Last 7 days',
  last_14d: 'Last 14 days',
  last_30d: 'Last 30 days',
  last_3m: 'Last 3 months',
  last_6m: 'Last 6 months',
  last_90d: 'Last 90 days',
  this_month: 'This month',
  last_month: 'Last month',
  last_year: 'Last year',
  last_2y: 'Last 2 years',
  maximum: 'All time',       // Meta only — falls back to last_30d on Google
}

export const QUICK_PRESETS = ['today', 'yesterday', 'last_7d', 'last_30d']
export const MORE_PRESETS = [
  'last_14d', 'last_3m', 'last_6m', 'last_90d',
  'this_month', 'last_month', 'last_year', 'last_2y', 'maximum',
]

// ── Date computation ──────────────────────────────────────────────────────────

/** Converts non-native presets to explicit since/until dates.
 *  Returns null for presets that platforms handle natively.
 */
export function computeCustomPreset(value: string): { since: string; until: string } | null {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const until = fmt(today)
  if (value === 'last_3m') { const d = new Date(today); d.setMonth(d.getMonth() - 3); return { since: fmt(d), until } }
  if (value === 'last_6m') { const d = new Date(today); d.setMonth(d.getMonth() - 6); return { since: fmt(d), until } }
  if (value === 'last_2y') { const d = new Date(today); d.setFullYear(d.getFullYear() - 2); return { since: fmt(d), until } }
  return null
}

// ── URL param helpers ─────────────────────────────────────────────────────────

/** Applies filter to URLSearchParams for the Meta Ads API. */
export function applyMetaDateParams(params: URLSearchParams, filter: DateFilter): void {
  if (filter.type === 'custom') {
    params.set('since', filter.since)
    params.set('until', filter.until)
    return
  }
  const custom = computeCustomPreset(filter.value)
  if (custom) {
    params.set('since', custom.since)
    params.set('until', custom.until)
  } else {
    params.set('date_preset', filter.value)
  }
}

/** Returns query-string fragment for the Meta Ads API. */
export function metaDateQuery(filter: DateFilter): string {
  const p = new URLSearchParams()
  applyMetaDateParams(p, filter)
  return p.toString()
}

/** Applies filter to URLSearchParams for the Google Ads API. */
export function applyGoogleDateParams(params: URLSearchParams, filter: DateFilter): void {
  if (filter.type === 'custom') {
    params.set('since', filter.since)
    params.set('until', filter.until)
    return
  }
  const custom = computeCustomPreset(filter.value)
  if (custom) {
    params.set('since', custom.since)
    params.set('until', custom.until)
  } else {
    // 'maximum' isn't a Google preset — fall back to last_30d
    params.set('date_preset', filter.value === 'maximum' ? 'last_30d' : filter.value)
  }
}

// ── Display ───────────────────────────────────────────────────────────────────

export function filterLabel(filter: DateFilter): string {
  if (filter.type === 'custom') return `${filter.since} → ${filter.until}`
  return PRESET_LABELS[filter.value] ?? filter.value
}
