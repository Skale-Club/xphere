// Aggregations over seo_gsc_daily rows for the Performance tab. Pure.

export interface DailyMetricRow {
  date: string
  device: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface Totals {
  clicks: number
  impressions: number
  /** clicks / impressions (0–1). */
  ctr: number
  /** Impression-weighted average position (lower is better); null without impressions. */
  position: number | null
}

export function totals(rows: DailyMetricRow[]): Totals {
  let clicks = 0
  let impressions = 0
  let weightedPosition = 0
  for (const r of rows) {
    clicks += r.clicks
    impressions += r.impressions
    weightedPosition += r.position * r.impressions
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? weightedPosition / impressions : null,
  }
}

/** One point per date (devices summed), oldest first, gaps filled with zeros. */
export function dailySeries(rows: DailyMetricRow[], startDate: string, endDate: string) {
  const byDate = new Map<string, DailyMetricRow[]>()
  for (const r of rows) {
    const list = byDate.get(r.date)
    if (list) list.push(r)
    else byDate.set(r.date, [r])
  }
  const out: Array<{ date: string } & Totals> = []
  for (let d = new Date(`${startDate}T00:00:00Z`); d <= new Date(`${endDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10)
    out.push({ date, ...totals(byDate.get(date) ?? []) })
  }
  return out
}

/** Relative change, or null when the previous value is 0 (no meaningful %). */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / previous
}
