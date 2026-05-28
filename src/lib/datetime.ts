/**
 * Timezone-aware date formatting. The org timezone (organizations.timezone) is
 * the source of truth for how dates render across the dashboard — these
 * helpers all take an explicit IANA `tz` so both server components (via
 * getOrgSettings) and client components (via OrgSettingsProvider) format the
 * same way regardless of where the code runs or the viewer's browser zone.
 *
 * Pure functions, no server/client deps — safe to import anywhere.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>()

function dtf(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + '|' + JSON.stringify(opts)
  let f = dtfCache.get(key)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts })
    } catch {
      // Unknown tz → fall back to UTC so we never throw at render time.
      f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts })
    }
    dtfCache.set(key, f)
  }
  return f
}

function toDate(input: string | number | Date): Date | null {
  const d = input instanceof Date ? input : new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "May 28, 2026" in the given timezone. */
export function formatDate(input: string | number | Date | null | undefined, tz: string): string {
  if (input == null) return ''
  const d = toDate(input)
  if (!d) return ''
  return dtf(tz, { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

/** "May 28, 2026, 9:30 PM" in the given timezone. */
export function formatDateTime(input: string | number | Date | null | undefined, tz: string): string {
  if (input == null) return ''
  const d = toDate(input)
  if (!d) return ''
  return dtf(tz, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

/**
 * Relative ("3m ago", "2h ago", "5d ago") for recent timestamps, falling back
 * to an absolute date (in `tz`) past ~30 days. Timezone-independent for the
 * relative buckets (they're deltas), tz-aware only for the absolute fallback.
 */
export function formatRelative(input: string | number | Date | null | undefined, tz: string): string {
  if (input == null) return ''
  const d = toDate(input)
  if (!d) return ''
  const ms = Date.now() - d.getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(d, tz)
}
