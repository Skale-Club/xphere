import { describe, it, expect } from 'vitest'

import {
  MAX_CATCHUP_LOOKBACK_MINUTES,
  computeDueWindow,
  isDue,
  computeStartsInTargetMinute,
  computeEndedTargetMinute,
  isStartsInCandidateStale,
  shouldAdvanceWatermark,
} from '@/lib/calendar/tick'

describe('calendar tick scheduling math (SCH-01 / SCH-02)', () => {
  describe('computeDueWindow', () => {
    it('returns { scanStart: watermark, scanEnd: now } when watermark is recent (no cap concern)', () => {
      const now = new Date('2026-07-20T14:00:00.000Z')
      const watermark = new Date('2026-07-20T13:50:00.000Z') // 10 minutes before now

      const window = computeDueWindow(now, watermark)

      expect(window.scanStart.toISOString()).toBe(watermark.toISOString())
      expect(window.scanEnd.toISOString()).toBe(now.toISOString())
    })

    it('falls back to the capped floor (now - MAX_CATCHUP_LOOKBACK_MINUTES) when watermark is null', () => {
      const now = new Date('2026-07-20T14:00:00.000Z')

      const window = computeDueWindow(now, null)

      const expectedFloor = new Date(
        now.getTime() - MAX_CATCHUP_LOOKBACK_MINUTES * 60_000,
      )
      expect(window.scanStart.toISOString()).toBe(expectedFloor.toISOString())
      expect(window.scanStart.toISOString()).toBe('2026-07-19T14:00:00.000Z')
      expect(window.scanEnd.toISOString()).toBe(now.toISOString())
    })

    it('clamps scanStart to now - 24h when watermark is a long-outage 3-day-old value (default cap)', () => {
      const now = new Date('2026-07-20T14:00:00.000Z')
      const watermark = new Date('2026-07-17T14:00:00.000Z') // 3 days before now

      const window = computeDueWindow(now, watermark)

      // NOT the actual 3-day-old watermark — proves the lookback cap actually caps.
      expect(window.scanStart.toISOString()).not.toBe(watermark.toISOString())
      expect(window.scanStart.toISOString()).toBe('2026-07-19T14:00:00.000Z')
    })

    it('honors an explicit smaller maxLookbackMinutes argument over the default constant', () => {
      const now = new Date('2026-07-20T14:00:00.000Z')

      const window = computeDueWindow(now, null, 30)

      expect(window.scanStart.toISOString()).toBe('2026-07-20T13:30:00.000Z')
    })
  })

  describe('isDue', () => {
    const scanStart = new Date('2026-07-20T13:50:00.000Z')
    const scanEnd = new Date('2026-07-20T14:00:00.000Z')
    const window = { scanStart, scanEnd }

    it('returns false when targetMinute exactly equals scanStart (exclusive lower bound)', () => {
      expect(isDue(scanStart, window)).toBe(false)
    })

    it('returns true when targetMinute exactly equals scanEnd (inclusive upper bound)', () => {
      expect(isDue(scanEnd, window)).toBe(true)
    })

    it('returns false when targetMinute is before scanStart', () => {
      const before = new Date('2026-07-20T13:49:00.000Z')
      expect(isDue(before, window)).toBe(false)
    })

    it('returns false when targetMinute is after scanEnd', () => {
      const after = new Date('2026-07-20T14:01:00.000Z')
      expect(isDue(after, window)).toBe(false)
    })
  })

  describe('computeStartsInTargetMinute', () => {
    it('adds a negative offset (before) to startAt and truncates to the minute', () => {
      const startAt = new Date('2026-07-20T14:00:00.000Z')

      const target = computeStartsInTargetMinute(startAt, -5)

      expect(target.toISOString()).toBe('2026-07-20T13:55:00.000Z')
    })

    it('is stable/idempotent — identical (startAt, offsetMinutes) yields bit-for-bit identical results across calls', () => {
      const startAt = new Date('2026-07-20T14:00:00.000Z')

      const first = computeStartsInTargetMinute(startAt, -5)
      const second = computeStartsInTargetMinute(startAt, -5)

      expect(first.toISOString()).toBe(second.toISOString())
    })
  })

  describe('computeEndedTargetMinute', () => {
    it('truncates seconds and milliseconds off endAt', () => {
      const endAt = new Date('2026-07-20T15:07:32.000Z')

      const target = computeEndedTargetMinute(endAt)

      expect(target.toISOString()).toBe('2026-07-20T15:07:00.000Z')
    })
  })

  describe('isStartsInCandidateStale', () => {
    it('returns true when startAt is in the past relative to now', () => {
      const now = new Date('2026-07-20T14:00:00.000Z')
      const startAt = new Date('2026-07-20T13:00:00.000Z')

      expect(isStartsInCandidateStale(startAt, now)).toBe(true)
    })

    it('returns false when startAt is in the future relative to now', () => {
      const now = new Date('2026-07-20T14:00:00.000Z')
      const startAt = new Date('2026-07-20T15:00:00.000Z')

      expect(isStartsInCandidateStale(startAt, now)).toBe(false)
    })

    it('returns true when startAt exactly equals now', () => {
      const now = new Date('2026-07-20T14:00:00.000Z')
      const startAt = new Date('2026-07-20T14:00:00.000Z')

      expect(isStartsInCandidateStale(startAt, now)).toBe(true)
    })
  })

  describe('shouldAdvanceWatermark', () => {
    it('returns true when releasedCount is 0 (nothing was retried this pass)', () => {
      expect(shouldAdvanceWatermark(0)).toBe(true)
    })

    it('returns false when releasedCount is any positive number', () => {
      expect(shouldAdvanceWatermark(1)).toBe(false)
      expect(shouldAdvanceWatermark(3)).toBe(false)
    })
  })
})
