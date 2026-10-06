// Pure math of the ads outcome reviewer (src/lib/ads/outcomes.ts): the UTC
// day windows around a change, when a change becomes due, batch grouping,
// deltas, confounders and the memory text.
//
// The windows are calendar days in UTC and must not depend on the process time
// zone: production runs TZ=UTC, this Windows box does not. Run this file under
// both, e.g.
//   TZ=UTC npx vitest run tests/ads-outcomes-math.test.ts
//   TZ=America/New_York npx vitest run tests/ads-outcomes-math.test.ts
// (see tests/calendar-wall-clock.test.ts for why both matter).

import { describe, expect, it, vi } from 'vitest'

// outcomes.ts imports the memory writer and the service-role client; neither
// is exercised by these pure functions.
vi.mock('@/lib/ads/journey-db', () => ({ createMemory: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))

import {
  addDays,
  buildOutcomeMemory,
  campaignTargets,
  formatPct,
  groupChanges,
  outcomeDeltas,
  outcomeWindows,
  reviewCutoffs,
  selectConfounders,
  summarizeOutcome,
  toOutcomeMetrics,
  unionKnowledgeRefs,
  utcDay,
  type OutcomeCampaign,
} from '@/lib/ads/outcomes'
import { aggregate, totalsByWindow, type DailyRow } from '@/lib/ads/snapshot'

const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone

describe(`outcome windows (process TZ: ${zone})`, () => {
  it('utcDay reads the UTC calendar day, not the local one', () => {
    // 23:30 UTC on Sep 20 is still Sep 20 in UTC, though it is the 20th 19:30
    // in New York and the 21st in Tokyo.
    expect(utcDay('2026-09-20T23:30:00.000Z')).toBe('2026-09-20')
    expect(utcDay('2026-09-21T00:30:00.000Z')).toBe('2026-09-21')
    expect(utcDay(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe('2026-01-01')
  })

  it('addDays crosses month, year and DST boundaries without drifting', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    // US DST ends 2026-11-01, Brazil/EU transitions nearby: a local-time
    // implementation would land on the wrong day here in a DST zone.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09')
  })

  it('before = the N full days before the change day, after = the N full days after it', () => {
    const w = outcomeWindows('2026-09-20T15:00:00.000Z', 7)
    expect(w.anchorDay).toBe('2026-09-20')
    expect(w.before).toEqual({ since: '2026-09-13', until: '2026-09-19' })
    expect(w.after).toEqual({ since: '2026-09-21', until: '2026-09-27' })
  })

  it('anchors on the UTC day even for a late-evening (US time) execution', () => {
    // 2026-09-20 23:30 in New York = 2026-09-21 03:30Z.
    const w = outcomeWindows('2026-09-21T03:30:00.000Z', 7)
    expect(w.anchorDay).toBe('2026-09-21')
    expect(w.before.until).toBe('2026-09-20')
    expect(w.after.since).toBe('2026-09-22')
  })

  it('handles a window that spans the US DST change', () => {
    const w = outcomeWindows('2026-10-30T12:00:00.000Z', 7)
    expect(w.before).toEqual({ since: '2026-10-23', until: '2026-10-29' })
    expect(w.after).toEqual({ since: '2026-10-31', until: '2026-11-06' })
  })

  it('a change is due only once its AFTER window ended a full UTC day before today', () => {
    const now = new Date('2026-10-06T05:10:00.000Z')
    const { dueBefore, expiredBefore } = reviewCutoffs(now, 7, 60)
    expect(dueBefore).toBe('2026-09-28T00:00:00.000Z')
    expect(expiredBefore).toBe('2026-08-07T05:10:00.000Z')

    // Latest due execution: 2026-09-27 23:59Z → after window ends 10-04, two
    // days before today's run.
    const latest = outcomeWindows('2026-09-27T23:59:00.000Z', 7)
    expect(latest.after.until).toBe('2026-10-04')
    expect(Date.parse('2026-09-27T23:59:00.000Z') < Date.parse(dueBefore)).toBe(true)
    // A change on 09-28 waits another night.
    expect(Date.parse('2026-09-28T00:00:00.000Z') < Date.parse(dueBefore)).toBe(false)
  })

  it('the cutoff is the same whatever the local hour of the run', () => {
    // Late in the UTC day vs right after UTC midnight: same UTC day, same cutoff.
    expect(reviewCutoffs(new Date('2026-10-06T23:59:59.000Z'), 7, 60).dueBefore).toBe('2026-09-28T00:00:00.000Z')
    expect(reviewCutoffs(new Date('2026-10-06T00:00:01.000Z'), 7, 60).dueBefore).toBe('2026-09-28T00:00:00.000Z')
  })
})

describe('grouping', () => {
  const row = (id: string, executed_at: string, batch_id: string | null = null, org_id = 'org-1') => ({ id, org_id, batch_id, executed_at })

  it('groups a batch together, anchored on its earliest execution', () => {
    const groups = groupChanges([
      row('a', '2026-09-01T10:00:00.000Z', 'batch-1'),
      row('b', '2026-09-01T09:00:00.000Z'),
      row('c', '2026-09-01T08:00:00.000Z', 'batch-1'),
    ])
    expect(groups.map((g) => g.changes.map((c) => c.id))).toEqual([['a', 'c'], ['b']])
    expect(groups[0].anchor).toBe('2026-09-01T08:00:00.000Z')
    expect(groups[0].batchId).toBe('batch-1')
    expect(groups[1].batchId).toBeNull()
  })

  it('never merges the same batch id across orgs, and ignores duplicate rows', () => {
    const groups = groupChanges([
      row('a', '2026-09-01T10:00:00.000Z', 'batch-1', 'org-1'),
      row('a', '2026-09-01T10:00:00.000Z', 'batch-1', 'org-1'),
      row('b', '2026-09-01T10:00:00.000Z', 'batch-1', 'org-2'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].changes).toHaveLength(1)
  })

  it('lists each campaign once and skips non-ads platforms', () => {
    expect(
      campaignTargets([
        { platform: 'google', ad_account_id: '1', campaign_id: 'c1' },
        { platform: 'google', ad_account_id: '1', campaign_id: 'c1' },
        { platform: 'meta', ad_account_id: 'act_2', campaign_id: 'c2' },
        { platform: 'google_business', ad_account_id: 'accounts/1/locations/2', campaign_id: 'x' },
        { platform: 'google', ad_account_id: '1', campaign_id: null },
      ]),
    ).toEqual([
      { platform: 'google', adAccountId: '1', campaignId: 'c1' },
      { platform: 'meta', adAccountId: 'act_2', campaignId: 'c2' },
    ])
  })
})

function daily(stat_date: string, spend_minor: number, clicks: number, conversions: number, leads = 0, impressions = clicks * 50): DailyRow {
  return { stat_date, spend_minor, clicks, conversions, leads, impressions, currency: 'USD' }
}

describe('metrics and deltas', () => {
  const windows = { before: { since: '2026-09-13', until: '2026-09-19' }, after: { since: '2026-09-21', until: '2026-09-27' } }
  const rows: DailyRow[] = [
    ...['13', '14', '15', '16', '17', '18', '19'].map((d) => daily(`2026-09-${d}`, 1000, 10, 1)),
    // The change day itself belongs to neither window.
    daily('2026-09-20', 99_999, 999, 99),
    ...['21', '22', '23', '24', '25', '26', '27'].map((d) => daily(`2026-09-${d}`, 1500, 20, 2)),
  ]

  it('splits stored rows into the two windows by date string, excluding the change day', () => {
    const t = totalsByWindow(rows, windows)
    expect(t.before.rows).toBe(7)
    expect(t.after.rows).toBe(7)
    expect(t.before.spend).toBe(70)
    expect(t.after.spend).toBe(105)
    expect(t.before.days).toBe(7)
  })

  it('computes cost per conversion and signed percent deltas', () => {
    const t = totalsByWindow(rows, windows)
    const before = toOutcomeMetrics(t.before)
    const after = toOutcomeMetrics(t.after)
    expect(before.cost_per_conversion).toBe(10)
    expect(after.cost_per_conversion).toBe(7.5)
    const d = outcomeDeltas(before, after)
    expect(d.spend).toBe(50)
    expect(d.clicks).toBe(100)
    expect(d.conversions).toBe(100)
    expect(d.cost_per_conversion).toBe(-25)
    expect(d.cpc).toBe(-25) // $1.00 → $0.75
    expect(d.ctr).toBe(0)
    // No leads on either side: no baseline, no delta.
    expect(d.leads).toBeNull()
    expect(d.cpl).toBeNull()
  })

  it('reports null (not -100%) when the baseline is zero', () => {
    const empty = toOutcomeMetrics(aggregate([]))
    const some = toOutcomeMetrics(aggregate([daily('2026-09-21', 500, 5, 1)]))
    const d = outcomeDeltas(empty, some)
    expect(d.spend).toBeNull()
    expect(d.cost_per_conversion).toBeNull()
    // Spend going to zero after a pause is a real -100%.
    expect(outcomeDeltas(some, empty).spend).toBe(-100)
  })

  it('formats deltas with a sign', () => {
    expect(formatPct(12.345)).toBe('+12.3%')
    expect(formatPct(-25)).toBe('-25.0%')
    expect(formatPct(null)).toBe('n/a')
  })
})

describe('confounders', () => {
  const windows = { before: { since: '2026-09-13', until: '2026-09-19' }, after: { since: '2026-09-21', until: '2026-09-27' } }
  const c = (id: string, executed_at: string | null) => ({ id, executed_at, command_type: 'google.campaign.set_status', campaign_id: 'c1' })

  it('keeps other changes inside [before.since, after.until] and drops the group and outsiders', () => {
    const out = selectConfounders(
      [
        c('self', '2026-09-20T10:00:00.000Z'),
        c('early-edge', '2026-09-13T00:00:00.000Z'),
        c('too-early', '2026-09-12T23:59:59.000Z'),
        c('late-edge', '2026-09-27T23:59:59.000Z'),
        c('too-late', '2026-09-28T00:00:00.000Z'),
        c('never-ran', null),
      ],
      new Set(['self']),
      windows,
    )
    expect(out.map((x) => x.id)).toEqual(['early-edge', 'late-edge'])
    expect(out[0].label).toBe('Set campaign status')
  })
})

describe('memory text', () => {
  const campaign: OutcomeCampaign = {
    platform: 'google',
    ad_account_id: '123',
    campaign_id: 'c1',
    campaign_name: 'Summer Sale',
    currency: 'USD',
    before: { days: 7, impressions: 3500, clicks: 70, spend: 70, conversions: 7, leads: 0, ctr: 2, cpc: 1, cpl: null, cost_per_conversion: 10 },
    after: { days: 7, impressions: 7000, clicks: 140, spend: 105, conversions: 14, leads: 0, ctr: 2, cpc: 0.75, cpl: null, cost_per_conversion: 7.5 },
    delta_pct: { spend: 50, impressions: 100, clicks: 100, conversions: 100, leads: null, ctr: 0, cpc: -25, cpl: null, cost_per_conversion: -25 },
    has_data: true,
  }
  const windows = { before: { since: '2026-09-13', until: '2026-09-19' }, after: { since: '2026-09-21', until: '2026-09-27' } }
  const change = {
    id: 'chg-1',
    command_type: 'google.campaign.set_daily_budget',
    resource_name: 'Summer Sale',
    resource_id: 'c1',
    resource_type: 'campaign',
    executed_at: '2026-09-20T15:00:00.000Z',
    actor_label: 'mcp:xph_ab12',
    rationale: 'CPA is 30% under target and impression share is lost to budget.',
    rollback_of: null,
    diff: [{ field: 'daily_budget', label: 'Daily budget', before: 10, after: 15, beforeDisplay: '$10.00', afterDisplay: '$15.00' }],
  }
  const refs = unionKnowledgeRefs([
    { knowledge_refs: [{ source_id: '11111111-1111-4111-8111-111111111111', source_name: null, url: null }] },
    { knowledge_refs: [{ source_id: '11111111-1111-4111-8111-111111111111', source_name: 'Budget scaling playbook', url: null }, 'junk'] },
  ])

  it('unions knowledge refs by source, keeping a known name', () => {
    expect(refs).toEqual([{ source_id: '11111111-1111-4111-8111-111111111111', source_name: 'Budget scaling playbook', url: null }])
  })

  it('says what changed, why, which knowledge, the metrics in the account currency, and the caveat', () => {
    const { title, content } = buildOutcomeMemory({ changes: [change], campaigns: [campaign], confounders: [], knowledgeRefs: refs, windowDays: 7, windows })
    expect(title).toBe('Result: Set campaign daily budget · Summer Sale')
    expect(content).toContain('Daily budget $10.00 → $15.00')
    expect(content).toContain('Why: CPA is 30% under target')
    expect(content).toContain('Grounded in: Budget scaling playbook')
    expect(content).toContain('2026-09-13 to 2026-09-19')
    expect(content).toContain('- Spend: $70.00 → $105.00 (+50.0%)')
    expect(content).toContain('- Cost per conversion: $10.00 → $7.50 (-25.0%)')
    expect(content).toContain('correlation, not proof')
    expect(content).not.toContain('cannot be attributed')
  })

  it('names confounders and warns that the effect cannot be attributed', () => {
    const { content } = buildOutcomeMemory({
      changes: [{ ...change, rollback_of: 'chg-0' }],
      campaigns: [campaign],
      confounders: [{ id: 'chg-9', label: 'Change campaign status', command_type: 'google.campaign.set_status', campaign_id: 'c1', executed_at: '2026-09-23T08:00:00.000Z' }],
      knowledgeRefs: [],
      windowDays: 7,
      windows,
    })
    expect(content).toContain('Change campaign status (2026-09-23, change chg-9)')
    expect(content).toContain('cannot be attributed to this change alone')
    expect(content).toContain('rollback of change chg-0')
  })

  it('summarises a batch in one title', () => {
    const { title } = buildOutcomeMemory({
      changes: [change, { ...change, id: 'chg-2' }],
      campaigns: [campaign],
      confounders: [],
      knowledgeRefs: [],
      windowDays: 7,
      windows,
    })
    expect(title).toBe('Result: 2 changes (Set campaign daily budget) · Summer Sale')
  })

  it('one-line summary carries the headline deltas', () => {
    expect(summarizeOutcome([campaign], 7, 1)).toBe(
      'Summer Sale: spend +50.0%, clicks +100.0%, conversions +100.0%, cost/conversion -25.0% (7d after vs 7d before; 1 other change in the window)',
    )
  })
})
