// Turning "the 25th at two o'clock" into an instant.
//
// The booking tool takes a date and a clock time, because that is what someone
// says out loud. Everything downstream — the slot check, the invite, the
// calendar row — works in UTC. The conversion between the two is the one step
// where an error is invisible: the booking succeeds, the confirmation reads
// back the time the caller asked for, and only on the day does anyone discover
// the meeting is an hour off.
//
// The case that actually broke: a wall-clock time whose UTC instant lands on
// the far side of a DST transition from where the naive reading puts it. On
// 1 November 2026 New York goes back at 06:00 UTC. Ask for 03:00 local, and the
// previous implementation returned 07:00Z — 02:00 in New York, an hour early.
//
// It did that ONLY when the server's own zone was UTC, because it round tripped
// through toLocaleString and let the two parses cancel out. On a developer
// machine in São Paulo it produced the right answer; in the container, which
// runs UTC, it did not. The fix samples the zone with formatToParts and takes a
// second pass at the instant actually being booked, so the server's zone plays
// no part. Hence the round-trip block below, and `TZ=UTC npx vitest run` on it.

import { describe, it, expect } from 'vitest'
import { isoFromParts } from '@/lib/action-engine/executors/calendar-book-meeting'

/** What a clock in `timeZone` reads at `iso`. */
function wallClockAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

describe('isoFromParts', () => {
  it('reads a summer afternoon in New York as EDT', () => {
    expect(isoFromParts('2026-09-25', '14:00', 'America/New_York')).toBe('2026-09-25T18:00:00.000Z')
  })

  it('reads a winter afternoon in New York as EST', () => {
    expect(isoFromParts('2026-12-15', '14:00', 'America/New_York')).toBe('2026-12-15T19:00:00.000Z')
  })

  it('reads São Paulo, which has not moved its clocks since 2019', () => {
    expect(isoFromParts('2026-09-25', '09:00', 'America/Sao_Paulo')).toBe('2026-09-25T12:00:00.000Z')
  })

  it('handles a zone ahead of UTC', () => {
    expect(isoFromParts('2026-09-25', '09:00', 'Europe/Lisbon')).toBe('2026-09-25T08:00:00.000Z')
  })

  // The regression. A single-pass conversion samples the offset on the wrong
  // side of the transition and files this an hour early.
  it('lands on the right side of a DST transition', () => {
    const iso = isoFromParts('2026-11-01', '03:00', 'America/New_York')
    expect(iso).toBe('2026-11-01T08:00:00.000Z')
    expect(wallClockAt(iso!, 'America/New_York')).toBe('01/11/2026, 03:00')
  })

  // Whatever the zone and the date, a clock there must read back what was
  // asked for. This is the property the two passes exist to hold.
  it.each([
    ['America/New_York', '2026-03-08', '09:00'],
    ['America/New_York', '2026-11-01', '09:00'],
    ['America/Sao_Paulo', '2026-06-30', '17:00'],
    ['Europe/Lisbon', '2026-03-29', '13:00'],
    ['Pacific/Auckland', '2026-09-27', '15:00'],
    ['Asia/Kolkata', '2026-09-25', '10:30'],
  ])('round-trips %s on %s at %s', (zone, date, time) => {
    const iso = isoFromParts(date, time, zone)
    expect(iso).not.toBeNull()
    expect(wallClockAt(iso!, zone).endsWith(time)).toBe(true)
  })

  it('refuses anything that is not a full date and a clock time', () => {
    for (const [date, time] of [
      ['25/09/2026', '14:00'],
      ['2026-09-25', '2pm'],
      ['2026-09-25', '9:00'],
      ['', ''],
    ]) {
      expect(isoFromParts(date, time, 'America/New_York')).toBeNull()
    }
  })
})
