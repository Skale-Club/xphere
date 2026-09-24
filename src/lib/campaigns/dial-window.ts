// When a campaign is allowed to dial.
//
// Pure: no I/O, no Supabase, no Date.now() of its own — hand it a moment and
// it answers. That is the only way a timezone rule can be tested without
// flakes, and the same discipline render-assistant-config.ts follows.
//
// It FAILS OPEN. A malformed window, an unknown IANA zone or a nonsense time
// string all resolve to "no restriction": a config typo must not silently stop
// every campaign in the platform from dialling. The cost of failing open is a
// call at the wrong hour; the cost of failing closed is a queue that never
// moves and nobody notices for a week.
//
// The window lives on the campaign rather than on the contact because a
// campaign is already per-language, and a language is in practice a timezone
// (the Portuguese callbacks are São Paulo hours, the English ones are Eastern).
// Per-contact timezones are a later refinement and belong in the engine's
// candidate filter, not here.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
export type DialWeekday = (typeof WEEKDAYS)[number]

/** One `["09:00","18:00"]` range, as minutes from midnight. */
interface DialRange {
  startMinutes: number
  endMinutes: number
}

export interface DialWindow {
  timezone: string
  /** A weekday with no entry, or an empty array, is closed. */
  days: Partial<Record<DialWeekday, DialRange[]>>
  /** Local YYYY-MM-DD dates the campaign must not dial on, whatever the weekday says. */
  blackoutDates: string[]
}

function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** "09:00" → 540. Anything else → null. */
function parseClock(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59) return null
  const total = hours * 60 + minutes
  return total > 24 * 60 ? null : total
}

/**
 * Reads the stored jsonb. Returns null for "no restriction" — which covers
 * `{}`, a missing timezone, an unknown zone, and any shape that does not
 * parse. A window with a valid timezone but no open day at all is a real
 * window: it says "never dial", and an operator who configured that meant it.
 */
export function parseDialWindow(value: unknown): DialWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (!isValidTimeZone(raw.timezone)) return null

  const daysRaw = raw.days
  if (!daysRaw || typeof daysRaw !== 'object' || Array.isArray(daysRaw)) return null

  const days: Partial<Record<DialWeekday, DialRange[]>> = {}
  let sawAnyDayKey = false

  for (const weekday of WEEKDAYS) {
    const entry = (daysRaw as Record<string, unknown>)[weekday]
    if (entry === undefined) continue
    sawAnyDayKey = true
    if (!Array.isArray(entry)) continue

    const ranges: DialRange[] = []
    for (const range of entry) {
      if (!Array.isArray(range) || range.length < 2) continue
      const startMinutes = parseClock(range[0])
      const endMinutes = parseClock(range[1])
      // A range that ends before it starts is a typo, not a window that wraps
      // past midnight: dropping it is safer than dialling for 23 hours.
      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue
      ranges.push({ startMinutes, endMinutes })
    }
    days[weekday] = ranges
  }

  if (!sawAnyDayKey) return null

  const blackoutDates = Array.isArray(raw.blackout_dates)
    ? raw.blackout_dates.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    : []

  return { timezone: raw.timezone, days, blackoutDates }
}

/** The moment, as the window's own timezone sees it. */
function localParts(window: DialWindow, now: Date): { weekday: DialWeekday; minutes: number; date: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: window.timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((p) => [p.type, p.value])
  ) as Record<string, string>

  const weekdayByAbbrev: Record<string, DialWeekday> = {
    Sun: 'sunday',
    Mon: 'monday',
    Tue: 'tuesday',
    Wed: 'wednesday',
    Thu: 'thursday',
    Fri: 'friday',
    Sat: 'saturday',
  }

  return {
    weekday: weekdayByAbbrev[parts.weekday] ?? 'sunday',
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

/** True when this campaign may dial right now. A null window means always. */
export function isWithinDialWindow(window: DialWindow | null, now: Date): boolean {
  if (!window) return true

  let local: ReturnType<typeof localParts>
  try {
    local = localParts(window, now)
  } catch {
    return true // fail open, same as an unparseable window
  }

  if (window.blackoutDates.includes(local.date)) return false

  const ranges = window.days[local.weekday] ?? []
  return ranges.some((r) => local.minutes >= r.startMinutes && local.minutes < r.endMinutes)
}

/**
 * When the window next opens, for logging and for telling an operator why
 * nothing was dialled. Scans the next 14 local days; null when the window
 * never opens (or there is no window, in which case "now" is always fine).
 */
export function nextDialWindowOpen(window: DialWindow | null, now: Date): Date | null {
  if (!window) return null
  if (isWithinDialWindow(window, now)) return now

  const stepMinutes = 15
  const horizonSteps = (14 * 24 * 60) / stepMinutes
  for (let step = 1; step <= horizonSteps; step++) {
    const candidate = new Date(now.getTime() + step * stepMinutes * 60_000)
    if (isWithinDialWindow(window, candidate)) return candidate
  }
  return null
}
