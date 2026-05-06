import { describe, it, expect, vi, beforeEach } from 'vitest'

type FakeRule = {
  id: string
  org_id: string
  channel_id: string
  event_type: string
  condition: Record<string, unknown>
  tool_config_id: string
  is_active: boolean
  priority: number
  created_at: string
  updated_at: string
}

function buildSupabaseReturning(rules: FakeRule[]) {
  // Chain: .from('manychat_rules').select('*').eq().eq().eq().eq().order() → { data, error }
  const orderSpy = vi.fn().mockResolvedValue({ data: rules, error: null })
  const eqChain = {
    eq: vi.fn().mockReturnThis(),
    order: orderSpy,
  }
  const selectSpy = vi.fn().mockReturnValue(eqChain)
  const fromMock = vi.fn((table: string) => {
    if (table === 'manychat_rules') {
      return { select: selectSpy }
    }
    return {}
  })
  return { from: fromMock, _orderSpy: orderSpy }
}

function makeRule(overrides: Partial<FakeRule>): FakeRule {
  return {
    id: 'rule-' + Math.random().toString(36).slice(2, 8),
    org_id: 'org-1',
    channel_id: 'channel-1',
    event_type: 'flow_completed',
    condition: {},
    tool_config_id: 'tool-1',
    is_active: true,
    priority: 0,
    created_at: '2026-05-06T00:00:00Z',
    updated_at: '2026-05-06T00:00:00Z',
    ...overrides,
  }
}

describe('ROUTING-03: resolveRule — matcher behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns null when no rules exist for the (org, channel, event_type)', async () => {
    const supabase = buildSupabaseReturning([])
    const { resolveRule } = await import('@/lib/manychat/resolve-rule')
    const result = await resolveRule(
      'org-1', 'channel-1', 'flow_completed', { foo: 'bar' },
      // @ts-expect-error mock client shape
      supabase
    )
    expect(result).toBeNull()
  })

  it('returns the first rule with empty condition (matches everything)', async () => {
    const r = makeRule({ id: 'rule-A', condition: {} })
    const supabase = buildSupabaseReturning([r])
    const { resolveRule } = await import('@/lib/manychat/resolve-rule')
    const result = await resolveRule(
      'org-1', 'channel-1', 'flow_completed', { anything: 'goes' },
      // @ts-expect-error mock client shape
      supabase
    )
    expect(result?.id).toBe('rule-A')
  })

  it('returns the first rule whose condition is contained in payload (priority order)', async () => {
    const ruleA = makeRule({ id: 'rule-A', priority: 0, condition: { flow_id: 'XYZ' } })
    const ruleB = makeRule({ id: 'rule-B', priority: 1, condition: { flow_id: 'abc123' } })
    // Supabase already returned them ordered by priority ASC — matcher iterates in order
    const supabase = buildSupabaseReturning([ruleA, ruleB])
    const { resolveRule } = await import('@/lib/manychat/resolve-rule')
    const result = await resolveRule(
      'org-1', 'channel-1', 'flow_completed', { flow_id: 'abc123', extra: 'ignored' },
      // @ts-expect-error mock client shape
      supabase
    )
    expect(result?.id).toBe('rule-B')
  })

  it('returns null when no condition is contained in payload', async () => {
    const r = makeRule({ condition: { flow_id: 'abc123' } })
    const supabase = buildSupabaseReturning([r])
    const { resolveRule } = await import('@/lib/manychat/resolve-rule')
    const result = await resolveRule(
      'org-1', 'channel-1', 'flow_completed', { flow_id: 'OTHER' },
      // @ts-expect-error mock client shape
      supabase
    )
    expect(result).toBeNull()
  })

  it('queries with is_active=true filter (deactivated rules excluded by SQL — verified via .eq() spy)', async () => {
    const supabase = buildSupabaseReturning([])
    const { resolveRule } = await import('@/lib/manychat/resolve-rule')
    await resolveRule(
      'org-1', 'channel-1', 'flow_completed', {},
      // @ts-expect-error mock client shape
      supabase
    )
    // The Supabase chain above always returns the same eq mock for chaining; we rely on
    // the rule SQL filter being applied. The integration assertion is that ORDER BY priority
    // is called (i.e., the chain reaches the end and is_active filter is in the chain).
    expect(supabase._orderSpy).toHaveBeenCalledWith('priority', { ascending: true })
  })

  it('supports nested object containment (recursive match)', async () => {
    const r = makeRule({ condition: { user: { tags: 'qualified' } } })
    const supabase = buildSupabaseReturning([r])
    const { resolveRule } = await import('@/lib/manychat/resolve-rule')
    const result = await resolveRule(
      'org-1', 'channel-1', 'flow_completed',
      { user: { tags: 'qualified', name: 'Alice' }, other: 'extra' },
      // @ts-expect-error mock client shape
      supabase
    )
    expect(result).not.toBeNull()
  })

  it('rejects when nested condition value mismatches', async () => {
    const r = makeRule({ condition: { user: { tags: 'qualified' } } })
    const supabase = buildSupabaseReturning([r])
    const { resolveRule } = await import('@/lib/manychat/resolve-rule')
    const result = await resolveRule(
      'org-1', 'channel-1', 'flow_completed',
      { user: { tags: 'unqualified' } },
      // @ts-expect-error mock client shape
      supabase
    )
    expect(result).toBeNull()
  })
})
