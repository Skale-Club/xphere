import { describe, it, expect } from 'vitest'
import { hasCreditsPlan } from '@/lib/billing/credits'

describe('hasCreditsPlan', () => {
  it('true when the resolved plan grants a nonzero Copilot allowance', () => {
    expect(hasCreditsPlan({ planCopilotIncludedUsd: 20, balanceIncludedAllowanceUsd: 0, balanceTotalUsd: 0 })).toBe(true)
  })

  it('true when the plan grants nothing but an existing balance row has a nonzero allowance', () => {
    expect(hasCreditsPlan({ planCopilotIncludedUsd: 0, balanceIncludedAllowanceUsd: 20, balanceTotalUsd: 0 })).toBe(true)
  })

  it('true when the plan grants nothing but the org has topup credits with spendable total', () => {
    expect(hasCreditsPlan({ planCopilotIncludedUsd: 0, balanceIncludedAllowanceUsd: 0, balanceTotalUsd: 10 })).toBe(true)
  })

  it('false when there is no plan allowance, no provisioned allowance, and no balance at all', () => {
    expect(hasCreditsPlan({ planCopilotIncludedUsd: 0, balanceIncludedAllowanceUsd: 0, balanceTotalUsd: 0 })).toBe(false)
  })
})
