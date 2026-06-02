import { describe, it, expect } from 'vitest'

import { costBreached, costSeverity, errorRateBreached } from '@/lib/obs/alerts'

describe('obs alert evaluation helpers', () => {
  describe('costBreached', () => {
    it('breaches at >= 80% of cap', () => {
      expect(costBreached(40, 50)).toBe(true) // 80%
      expect(costBreached(39.99, 50)).toBe(false)
      expect(costBreached(60, 50)).toBe(true) // over cap
    })
    it('never breaches with a non-positive cap', () => {
      expect(costBreached(100, 0)).toBe(false)
      expect(costBreached(100, -5)).toBe(false)
    })
  })

  describe('costSeverity', () => {
    it('is critical at/over 100%, warning below', () => {
      expect(costSeverity(80)).toBe('warning')
      expect(costSeverity(99)).toBe('warning')
      expect(costSeverity(100)).toBe('critical')
      expect(costSeverity(140)).toBe('critical')
    })
  })

  describe('errorRateBreached', () => {
    it('requires minimum volume', () => {
      expect(errorRateBreached(10, 10)).toBe(false) // below default minVolume 20
    })
    it('breaches at >= 25% with enough volume', () => {
      expect(errorRateBreached(20, 5)).toBe(true) // exactly 25%
      expect(errorRateBreached(100, 24)).toBe(false) // 24%
      expect(errorRateBreached(100, 25)).toBe(true)
    })
    it('honors custom thresholds', () => {
      expect(errorRateBreached(50, 5, 10, 0.05)).toBe(true)
      expect(errorRateBreached(50, 2, 10, 0.05)).toBe(false) // 4%
    })
  })
})
