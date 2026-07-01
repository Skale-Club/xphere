import { describe, it, expect } from 'vitest'
import { getCreditsVisualState } from '@/lib/billing/credits'

describe('getCreditsVisualState', () => {
  it('zero balance is the zero state', () => {
    expect(getCreditsVisualState(0, 20)).toBe('zero')
  })

  it('negative balance is still the zero state', () => {
    expect(getCreditsVisualState(-5, 20)).toBe('zero')
  })

  it('exactly 20% of allowance is the low state (inclusive boundary)', () => {
    expect(getCreditsVisualState(4, 20)).toBe('low')
  })

  it('below 20% of allowance is the low state', () => {
    expect(getCreditsVisualState(3, 20)).toBe('low')
  })

  it('just above 20% of allowance is healthy', () => {
    expect(getCreditsVisualState(4.01, 20)).toBe('healthy')
  })

  it('full balance is healthy', () => {
    expect(getCreditsVisualState(20, 20)).toBe('healthy')
  })

  it('no allowance concept (allowance is 0) with a positive balance is healthy', () => {
    expect(getCreditsVisualState(15, 0)).toBe('healthy')
  })

  it('no allowance and no balance is zero', () => {
    expect(getCreditsVisualState(0, 0)).toBe('zero')
  })
})
