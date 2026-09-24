// When a campaign may dial.
//
// The rule is a timezone rule, so the tests are written against fixed instants
// in two zones that behave differently: America/Sao_Paulo has had no DST since
// 2019, America/New_York still does. A rule that only ever gets exercised in
// the machine's own zone is a rule nobody has tested.
//
// The other half of this file is the fail-open contract. A malformed window
// must mean "dial any time", never "dial never": a typo in one campaign's
// config cannot be allowed to quietly stop the whole platform's outbound.

import { describe, it, expect } from 'vitest'
import { isWithinDialWindow, nextDialWindowOpen, parseDialWindow } from '@/lib/campaigns/dial-window'

const BUSINESS_HOURS = {
  timezone: 'America/Sao_Paulo',
  days: {
    monday: [['09:00', '18:00']],
    tuesday: [['09:00', '18:00']],
    wednesday: [['09:00', '18:00']],
    thursday: [['09:00', '18:00']],
    friday: [['09:00', '18:00']],
    saturday: [],
  },
  blackout_dates: ['2026-12-25'],
}

describe('parseDialWindow', () => {
  it('reads a well-formed window', () => {
    const window = parseDialWindow(BUSINESS_HOURS)
    expect(window?.timezone).toBe('America/Sao_Paulo')
    expect(window?.days.monday).toEqual([{ startMinutes: 540, endMinutes: 1080 }])
    expect(window?.days.saturday).toEqual([])
    expect(window?.days.sunday).toBeUndefined()
    expect(window?.blackoutDates).toEqual(['2026-12-25'])
  })

  it('returns null — dial any time — for everything it cannot use', () => {
    expect(parseDialWindow({})).toBeNull()
    expect(parseDialWindow(null)).toBeNull()
    expect(parseDialWindow('09:00-18:00')).toBeNull()
    expect(parseDialWindow([])).toBeNull()
    expect(parseDialWindow({ days: { monday: [['09:00', '18:00']] } })).toBeNull() // no timezone
    expect(parseDialWindow({ timezone: 'Mars/Olympus', days: { monday: [] } })).toBeNull()
    expect(parseDialWindow({ timezone: 'America/Sao_Paulo' })).toBeNull() // no days key at all
  })

  it('drops a range it cannot read instead of the whole window', () => {
    const window = parseDialWindow({
      timezone: 'America/Sao_Paulo',
      days: { monday: [['09:00', '18:00'], ['nonsense', '18:00'], ['18:00', '09:00']] },
    })
    // The reversed range is a typo, not a window that wraps past midnight.
    expect(window?.days.monday).toEqual([{ startMinutes: 540, endMinutes: 1080 }])
  })

  it('ignores blackout dates that are not dates', () => {
    const window = parseDialWindow({ ...BUSINESS_HOURS, blackout_dates: ['tomorrow', 42, '2026-12-25'] })
    expect(window?.blackoutDates).toEqual(['2026-12-25'])
  })
})

describe('isWithinDialWindow', () => {
  const window = parseDialWindow(BUSINESS_HOURS)

  it('has no opinion when there is no window', () => {
    expect(isWithinDialWindow(null, new Date('2026-09-24T03:00:00Z'))).toBe(true)
  })

  it('opens and closes on the tenant clock, not on UTC', () => {
    // São Paulo is UTC-3 all year.
    expect(isWithinDialWindow(window, new Date('2026-09-24T11:00:00Z'))).toBe(false) // 08:00 local
    expect(isWithinDialWindow(window, new Date('2026-09-24T12:00:00Z'))).toBe(true) // 09:00 local
    expect(isWithinDialWindow(window, new Date('2026-09-24T20:59:00Z'))).toBe(true) // 17:59 local
    expect(isWithinDialWindow(window, new Date('2026-09-24T21:00:00Z'))).toBe(false) // 18:00 local, exclusive end
    expect(isWithinDialWindow(window, new Date('2026-09-25T04:00:00Z'))).toBe(false) // 01:00 local
  })

  it('treats a day with no ranges, and a day with no entry, as closed', () => {
    expect(isWithinDialWindow(window, new Date('2026-09-26T15:00:00Z'))).toBe(false) // Saturday noon
    expect(isWithinDialWindow(window, new Date('2026-09-27T15:00:00Z'))).toBe(false) // Sunday noon
  })

  it('refuses a blackout date whatever the weekday says', () => {
    // 2026-12-25 is a Friday, inside the weekday window.
    expect(isWithinDialWindow(window, new Date('2026-12-25T15:00:00Z'))).toBe(false)
    expect(isWithinDialWindow(window, new Date('2026-12-24T15:00:00Z'))).toBe(true)
  })

  it('follows daylight saving in a zone that has it', () => {
    const eastern = parseDialWindow({
      timezone: 'America/New_York',
      days: { wednesday: [['09:00', '18:00']], thursday: [['09:00', '18:00']] },
    })
    // 13:30 UTC is 09:30 EDT (summer, open) and 08:30 EST (winter, closed).
    expect(isWithinDialWindow(eastern, new Date('2026-07-15T13:30:00Z'))).toBe(true)
    expect(isWithinDialWindow(eastern, new Date('2026-01-14T13:30:00Z'))).toBe(false)
    expect(isWithinDialWindow(eastern, new Date('2026-01-14T14:30:00Z'))).toBe(true) // 09:30 EST
  })

  it('handles two ranges in one day, with a lunch break between them', () => {
    const split = parseDialWindow({
      timezone: 'America/Sao_Paulo',
      days: { thursday: [['09:00', '12:00'], ['14:00', '18:00']] },
    })
    expect(isWithinDialWindow(split, new Date('2026-09-24T13:00:00Z'))).toBe(true) // 10:00
    expect(isWithinDialWindow(split, new Date('2026-09-24T16:00:00Z'))).toBe(false) // 13:00
    expect(isWithinDialWindow(split, new Date('2026-09-24T18:00:00Z'))).toBe(true) // 15:00
  })
})

describe('nextDialWindowOpen', () => {
  const window = parseDialWindow(BUSINESS_HOURS)

  it('is now when the window is already open', () => {
    const now = new Date('2026-09-24T12:00:00Z')
    expect(nextDialWindowOpen(window, now)).toEqual(now)
  })

  it('finds the next opening across a weekend', () => {
    const fridayEvening = new Date('2026-09-25T22:00:00Z') // 19:00 local Friday
    const next = nextDialWindowOpen(window, fridayEvening)
    expect(next).not.toBeNull()
    // Monday 09:00 local = 12:00 UTC.
    expect(next!.toISOString().slice(0, 13)).toBe('2026-09-28T12')
  })

  it('is null when there is no window, and when the window never opens', () => {
    expect(nextDialWindowOpen(null, new Date())).toBeNull()
    const never = parseDialWindow({ timezone: 'America/Sao_Paulo', days: { monday: [] } })
    expect(nextDialWindowOpen(never, new Date('2026-09-24T12:00:00Z'))).toBeNull()
  })
})
