import { describe, it, expect } from 'vitest'
import { phoneToTimezone, describeDestinationTime } from '@/lib/phone-numbers/timezone'

describe('phoneToTimezone', () => {
  it('Brazil São Paulo (DDD 11)', () => {
    expect(phoneToTimezone('+5511987654321')?.timeZone).toBe('America/Sao_Paulo')
  })
  it('Brazil Acre (DDD 68)', () => {
    expect(phoneToTimezone('+5568999990000')?.timeZone).toBe('America/Rio_Branco')
  })
  it('Brazil Manaus (DDD 92)', () => {
    expect(phoneToTimezone('+5592999990000')?.timeZone).toBe('America/Manaus')
  })
  it('US California (415) → Pacific', () => {
    expect(phoneToTimezone('+14155551234')?.timeZone).toBe('America/Los_Angeles')
  })
  it('US New York (212) → Eastern default', () => {
    expect(phoneToTimezone('+12125551234')?.timeZone).toBe('America/New_York')
  })
  it('US Chicago (312) → Central', () => {
    expect(phoneToTimezone('+13125551234')?.timeZone).toBe('America/Chicago')
  })
  it('UK → London', () => {
    expect(phoneToTimezone('+442079460000')?.timeZone).toBe('Europe/London')
  })
  it('unmapped/garbage → null', () => {
    expect(phoneToTimezone('not-a-number')).toBeNull()
  })
  it('describe computes diff vs viewer', () => {
    const d = describeDestinationTime('+14155551234', new Date('2026-06-10T18:00:00Z'), 'America/Sao_Paulo')
    expect(d?.label).toBe('Pacific Time')
    // SP is UTC-3, LA is UTC-7 (DST) → 4h behind
    expect(d?.diffMinutes).toBe(-240)
    expect(d?.diffLabel).toBe('4h behind')
  })
})
