import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  defaultPolicy,
  evaluatePolicy,
  globalMaxDailyBudget,
  mergePolicies,
  type PolicyRow,
} from '@/lib/ads/commands/policies'
import type { AdsActor, PolicyFacts } from '@/lib/ads/commands/types'

function row(overrides: Partial<PolicyRow> = {}): PolicyRow {
  return {
    platform: null,
    ad_account_id: null,
    max_daily_budget: null,
    max_budget_increase_pct: null,
    allow_enable: null,
    allow_bidding_changes: null,
    allow_bulk: null,
    ai_mode: null,
    require_approval_min_risk: null,
    approval_ttl_minutes: null,
    protected_campaign_ids: null,
    ...overrides,
  }
}

function human(overrides: Partial<AdsActor> = {}): AdsActor {
  return { type: 'user', id: 'u1', label: 'user:u1', canManage: true, canApprove: false, ...overrides }
}

function ai(overrides: Partial<AdsActor> = {}): AdsActor {
  return { type: 'ai', id: 'agent-1', label: 'mcp:xph_ab12', canManage: false, canApprove: false, ...overrides }
}

const NO_FACTS: PolicyFacts = {}

beforeEach(() => {
  delete process.env.ADS_MAX_DAILY_BUDGET
})
afterEach(() => {
  delete process.env.ADS_MAX_DAILY_BUDGET
})

// ─── mergePolicies precedence ───────────────────────────────────────────────────

describe('mergePolicies — precedence', () => {
  it('an org-wide default row is used when nothing more specific exists', () => {
    const policy = mergePolicies([row({ max_daily_budget: 500 })], 'google', '123')
    expect(policy.maxDailyBudget).toBe(500)
  })

  it('a platform-specific row overrides the org-wide default', () => {
    const rows = [row({ max_daily_budget: 500 }), row({ platform: 'google', max_daily_budget: 800 })]
    expect(mergePolicies(rows, 'google', '123').maxDailyBudget).toBe(800)
    // A different platform never sees the google-only override.
    expect(mergePolicies(rows, 'meta', '123').maxDailyBudget).toBe(500)
  })

  it('an account-specific row overrides a platform-specific row for the same account', () => {
    const rows = [
      row({ max_daily_budget: 500 }),
      row({ platform: 'google', max_daily_budget: 800 }),
      row({ ad_account_id: '123', max_daily_budget: 1_200 }),
    ]
    expect(mergePolicies(rows, 'google', '123').maxDailyBudget).toBe(1_200)
    // The account row is scoped to account 123 only.
    expect(mergePolicies(rows, 'google', '999').maxDailyBudget).toBe(800)
  })

  it('an account+platform row wins over every less specific row', () => {
    const rows = [
      row({ max_daily_budget: 500 }),
      row({ platform: 'google', max_daily_budget: 800 }),
      row({ ad_account_id: '123', max_daily_budget: 1_200 }),
      row({ platform: 'google', ad_account_id: '123', max_daily_budget: 2_000 }),
    ]
    expect(mergePolicies(rows, 'google', '123').maxDailyBudget).toBe(2_000)
  })

  it('protected_campaign_ids accumulate across applicable rows instead of the most specific row replacing the list', () => {
    const rows = [
      row({ protected_campaign_ids: ['org-protected-1'] }),
      row({ ad_account_id: '123', protected_campaign_ids: ['account-protected-1', 'account-protected-2'] }),
    ]
    const policy = mergePolicies(rows, 'google', '123')
    expect(new Set(policy.protectedCampaignIds)).toEqual(
      new Set(['org-protected-1', 'account-protected-1', 'account-protected-2']),
    )
  })

  it('ADS_MAX_DAILY_BUDGET caps any policy value, even a very permissive one', () => {
    process.env.ADS_MAX_DAILY_BUDGET = '1000'
    const policy = mergePolicies([row({ max_daily_budget: 999_999 })], 'google', '123')
    expect(policy.maxDailyBudget).toBe(1000)
  })

  it('ADS_MAX_DAILY_BUDGET does not raise a policy that is already lower than it', () => {
    process.env.ADS_MAX_DAILY_BUDGET = '1000'
    const policy = mergePolicies([row({ max_daily_budget: 50 })], 'google', '123')
    expect(policy.maxDailyBudget).toBe(50)
  })

  it('globalMaxDailyBudget falls back to the built-in default when unset or invalid', () => {
    expect(globalMaxDailyBudget()).toBe(10_000)
    process.env.ADS_MAX_DAILY_BUDGET = 'not-a-number'
    expect(globalMaxDailyBudget()).toBe(10_000)
    process.env.ADS_MAX_DAILY_BUDGET = '-5'
    expect(globalMaxDailyBudget()).toBe(10_000)
  })

  it('an unset field falls through to defaultPolicy() rather than null/undefined', () => {
    const policy = mergePolicies([], 'google', '123')
    expect(policy).toEqual(defaultPolicy())
  })
})

// ─── evaluatePolicy ─────────────────────────────────────────────────────────────

describe('evaluatePolicy — budget ceiling and increase pct', () => {
  it('blocks a budget above the account ceiling', () => {
    const policy = { ...defaultPolicy(), maxDailyBudget: 100 }
    const verdict = evaluatePolicy({
      policy,
      actor: human(),
      risk: 1,
      campaignId: 'c1',
      facts: { budgetAfter: 150 },
    })
    expect(verdict.blocked.map((v) => v.code)).toContain('budget_ceiling')
  })

  it('requires approval for an increase beyond the allowed percentage, without blocking it', () => {
    const policy = { ...defaultPolicy(), maxDailyBudget: 10_000, maxBudgetIncreasePct: 50 }
    const verdict = evaluatePolicy({
      policy,
      actor: human(),
      risk: 1,
      campaignId: 'c1',
      facts: { budgetBefore: 100, budgetAfter: 200 }, // +100%
    })
    expect(verdict.blocked).toHaveLength(0)
    expect(verdict.approvalReasons.map((v) => v.code)).toContain('budget_increase')
  })

  it('does not require approval for an increase within the allowed percentage', () => {
    const policy = { ...defaultPolicy(), maxDailyBudget: 10_000, maxBudgetIncreasePct: 100 }
    const verdict = evaluatePolicy({
      policy,
      actor: human({ canApprove: true }),
      risk: 1,
      campaignId: 'c1',
      facts: { budgetBefore: 100, budgetAfter: 150 },
    })
    expect(verdict.approvalReasons.map((v) => v.code)).not.toContain('budget_increase')
  })
})

describe('evaluatePolicy — AI mode', () => {
  it('blocks every AI-proposed change on a read_only account', () => {
    const policy = { ...defaultPolicy(), aiMode: 'read_only' as const }
    const verdict = evaluatePolicy({ policy, actor: ai(), risk: 1, campaignId: null, facts: NO_FACTS })
    expect(verdict.blocked.map((v) => v.code)).toContain('ai_read_only')
  })

  it('always attaches the machine_actor approval reason for a machine actor, regardless of risk', () => {
    const policy = defaultPolicy() // propose mode, not read_only
    const verdict = evaluatePolicy({ policy, actor: ai(), risk: 1, campaignId: null, facts: NO_FACTS })
    expect(verdict.blocked).toHaveLength(0)
    expect(verdict.approvalReasons.map((v) => v.code)).toContain('machine_actor')
  })

  it('never marks a machine actor as self-approvable', () => {
    const policy = defaultPolicy()
    const verdict = evaluatePolicy({ policy, actor: ai(), risk: 1, campaignId: null, facts: NO_FACTS })
    expect(verdict.selfApprovable).toBe(false)
  })
})

describe('evaluatePolicy — protected campaigns', () => {
  const policy = { ...defaultPolicy(), protectedCampaignIds: ['protected-1'] }

  it('blocks an AI actor touching a protected campaign outright', () => {
    const verdict = evaluatePolicy({ policy, actor: ai(), risk: 1, campaignId: 'protected-1', facts: NO_FACTS })
    expect(verdict.blocked.map((v) => v.code)).toContain('protected_campaign')
  })

  it('only requires approval when a human touches the same protected campaign', () => {
    const verdict = evaluatePolicy({ policy, actor: human(), risk: 1, campaignId: 'protected-1', facts: NO_FACTS })
    expect(verdict.blocked.map((v) => v.code)).not.toContain('protected_campaign')
    expect(verdict.approvalReasons.map((v) => v.code)).toContain('protected_campaign')
  })

  it('does not flag a campaign that is not on the protected list', () => {
    const verdict = evaluatePolicy({ policy, actor: human(), risk: 1, campaignId: 'other-campaign', facts: NO_FACTS })
    expect(verdict.blocked).toHaveLength(0)
    expect(verdict.approvalReasons.map((v) => v.code)).not.toContain('protected_campaign')
  })
})

describe('evaluatePolicy — allow_enable / allow_bidding_changes / allow_bulk', () => {
  it('blocks a machine actor from enabling when allow_enable is false', () => {
    const policy = { ...defaultPolicy(), allowEnable: false }
    const verdict = evaluatePolicy({ policy, actor: ai(), risk: 1, campaignId: null, facts: { enables: true } })
    expect(verdict.blocked.map((v) => v.code)).toContain('enable_not_allowed')
  })

  it('only requires human approval to enable when allow_enable is false', () => {
    const policy = { ...defaultPolicy(), allowEnable: false }
    const verdict = evaluatePolicy({ policy, actor: human(), risk: 1, campaignId: null, facts: { enables: true } })
    expect(verdict.blocked.map((v) => v.code)).not.toContain('enable_not_allowed')
    expect(verdict.approvalReasons.map((v) => v.code)).toContain('enable_not_allowed')
  })

  it('blocks a machine actor from a bidding change when allow_bidding_changes is false', () => {
    const policy = { ...defaultPolicy(), allowBiddingChanges: false }
    const verdict = evaluatePolicy({ policy, actor: ai(), risk: 3, campaignId: null, facts: { biddingChange: true } })
    expect(verdict.blocked.map((v) => v.code)).toContain('bidding_not_allowed')
  })

  it('only requires human approval for a bidding change when allow_bidding_changes is false', () => {
    const policy = { ...defaultPolicy(), allowBiddingChanges: false }
    const verdict = evaluatePolicy({ policy, actor: human(), risk: 3, campaignId: null, facts: { biddingChange: true } })
    expect(verdict.blocked.map((v) => v.code)).not.toContain('bidding_not_allowed')
    expect(verdict.approvalReasons.map((v) => v.code)).toContain('bidding_not_allowed')
  })

  it('blocks a machine actor from a bulk change when allow_bulk is false', () => {
    const policy = { ...defaultPolicy(), allowBulk: false }
    const verdict = evaluatePolicy({ policy, actor: ai(), risk: 1, campaignId: null, facts: NO_FACTS, batchSize: 5 })
    expect(verdict.blocked.map((v) => v.code)).toContain('bulk_not_allowed')
  })

  it('only requires human approval for a bulk change when allow_bulk is false', () => {
    const policy = { ...defaultPolicy(), allowBulk: false }
    const verdict = evaluatePolicy({ policy, actor: human(), risk: 1, campaignId: null, facts: NO_FACTS, batchSize: 5 })
    expect(verdict.blocked.map((v) => v.code)).not.toContain('bulk_not_allowed')
    expect(verdict.approvalReasons.map((v) => v.code)).toContain('bulk_not_allowed')
  })

  it('a single-command batch (or no batchSize) never trips the bulk rule', () => {
    const policy = { ...defaultPolicy(), allowBulk: false }
    const verdict = evaluatePolicy({ policy, actor: human(), risk: 1, campaignId: null, facts: NO_FACTS })
    expect(verdict.approvalReasons.map((v) => v.code)).not.toContain('bulk_not_allowed')
  })
})

describe('evaluatePolicy — human risk threshold and permissions', () => {
  it('requires approval when a human change is at or above requireApprovalMinRisk', () => {
    const policy = { ...defaultPolicy(), requireApprovalMinRisk: 3 }
    const verdict = evaluatePolicy({ policy, actor: human(), risk: 3, campaignId: null, facts: NO_FACTS })
    expect(verdict.approvalReasons.map((v) => v.code)).toContain('risk_level')
  })

  it('does not require approval on risk_level when a human change is below the threshold', () => {
    const policy = { ...defaultPolicy(), requireApprovalMinRisk: 3 }
    const verdict = evaluatePolicy({ policy, actor: human(), risk: 2, campaignId: null, facts: NO_FACTS })
    expect(verdict.approvalReasons).toHaveLength(0)
  })

  it('blocks a human with no ads.manage permission outright', () => {
    const policy = defaultPolicy()
    const verdict = evaluatePolicy({ policy, actor: human({ canManage: false }), risk: 1, campaignId: null, facts: NO_FACTS })
    expect(verdict.blocked.map((v) => v.code)).toContain('missing_permission')
  })

  it('selfApprovable is true only for a human holding ads.approve', () => {
    const policy = defaultPolicy()
    const approver = evaluatePolicy({ policy, actor: human({ canApprove: true }), risk: 1, campaignId: null, facts: NO_FACTS })
    const nonApprover = evaluatePolicy({ policy, actor: human({ canApprove: false }), risk: 1, campaignId: null, facts: NO_FACTS })
    const machine = evaluatePolicy({ policy, actor: ai(), risk: 1, campaignId: null, facts: NO_FACTS })
    expect(approver.selfApprovable).toBe(true)
    expect(nonApprover.selfApprovable).toBe(false)
    expect(machine.selfApprovable).toBe(false)
  })
})
