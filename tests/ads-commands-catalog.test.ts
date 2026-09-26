import { describe, expect, it } from 'vitest'

import { checkCommandShape, parseCommand } from '@/lib/ads/commands/catalog'

// ─── Valid commands ─────────────────────────────────────────────────────────────
// One happy-path shape per platform, so a change to the discriminated union
// (a renamed field, a tightened schema) fails here first instead of three
// layers deeper in the engine tests.

describe('parseCommand — valid commands', () => {
  it('accepts a well-formed Google command', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status',
      campaign_id: '111222333',
      status: 'ENABLED',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a well-formed Meta command', () => {
    const result = parseCommand({
      platform: 'meta',
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_status',
      campaign_id: '120200000000000',
      status: 'ACTIVE',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a Google keyword add with a within-limits keyword', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.keyword.add',
      ad_group_id: '999',
      text: 'running shoes for men',
      match_type: 'PHRASE',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a Meta targeting update with at least one field', () => {
    const result = parseCommand({
      platform: 'meta',
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting',
      adset_id: '120200000000001',
      age_min: 18,
      age_max: 45,
    })
    expect(result.ok).toBe(true)
  })
})

// ─── Bad ids ────────────────────────────────────────────────────────────────────
// Meta account ids and Google resource ids use different id shapes; a command
// built for the wrong platform (or hand-typed) must be rejected before it
// reaches a query literal or an API call.

describe('parseCommand — id shape', () => {
  it('rejects a Meta ad account id missing the act_ prefix', () => {
    const result = parseCommand({
      platform: 'meta',
      ad_account_id: '123456789',
      type: 'meta.campaign.set_status',
      campaign_id: '120200000000000',
      status: 'ACTIVE',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a Meta campaign id that is not purely numeric', () => {
    const result = parseCommand({
      platform: 'meta',
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_status',
      campaign_id: '1' + "' OR '1'='1",
      status: 'ACTIVE',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a Google campaign id with dashes', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status',
      campaign_id: '111-222-333',
      status: 'ENABLED',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a Google ad_account_id in Meta act_ form', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: 'act_1234567890',
      type: 'google.campaign.set_status',
      campaign_id: '111222333',
      status: 'ENABLED',
    })
    expect(result.ok).toBe(false)
  })
})

// ─── Keyword text limits ────────────────────────────────────────────────────────
// These mirror Google's own keyword restrictions; catching them here produces
// a clear message instead of a generic INVALID_ARGUMENT after a round trip.

describe('parseCommand — keyword text', () => {
  const base = {
    platform: 'google' as const,
    ad_account_id: '1234567890',
    type: 'google.keyword.add' as const,
    ad_group_id: '999',
    match_type: 'EXACT' as const,
  }

  it('rejects a keyword containing a forbidden character', () => {
    for (const bad of ['shoes!', 'a(b)', 'x=y', 'foo;bar', 'a<b>', 'a|b', 'a~b', 'a`b', 'a%b', 'a^b']) {
      const result = parseCommand({ ...base, text: bad })
      expect(result.ok, `expected "${bad}" to be rejected`).toBe(false)
    }
  })

  it('rejects a keyword with more than 10 words', () => {
    const result = parseCommand({ ...base, text: Array.from({ length: 11 }, (_, i) => `w${i}`).join(' ') })
    expect(result.ok).toBe(false)
  })

  it('accepts a keyword with exactly 10 words', () => {
    const result = parseCommand({ ...base, text: Array.from({ length: 10 }, (_, i) => `w${i}`).join(' ') })
    expect(result.ok).toBe(true)
  })

  it('rejects a keyword longer than 80 characters', () => {
    const result = parseCommand({ ...base, text: 'a'.repeat(81) })
    expect(result.ok).toBe(false)
  })

  it('accepts a keyword at exactly 80 characters', () => {
    const result = parseCommand({ ...base, text: 'a'.repeat(80) })
    expect(result.ok).toBe(true)
  })

  it('rejects an empty keyword', () => {
    const result = parseCommand({ ...base, text: '   ' })
    expect(result.ok).toBe(false)
  })
})

// ─── Cross-field rules (checkCommandShape) ──────────────────────────────────────
// The discriminated union can express "level: campaign with no campaign_id" —
// zod alone can't reject that combination, so checkCommandShape is the only
// thing standing between it and a 500 deep in the Google Ads client.

describe('parseCommand — negative keyword level/id coherence', () => {
  it('rejects a campaign-level negative keyword with no campaign_id', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.negative_keyword.add',
      level: 'campaign',
      text: 'competitor brand',
      match_type: 'PHRASE',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/campaign_id/)
  })

  it('rejects an ad-group-level negative keyword with no ad_group_id', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.negative_keyword.remove',
      level: 'ad_group',
      criterion_id: '555',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/ad_group_id/)
  })

  it('accepts a campaign-level negative keyword that includes campaign_id', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.negative_keyword.add',
      level: 'campaign',
      campaign_id: '111',
      text: 'competitor brand',
      match_type: 'PHRASE',
    })
    expect(result.ok).toBe(true)
  })

  it('checkCommandShape returns null for a coherent command', () => {
    const parsed = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status',
      campaign_id: '111',
      status: 'ENABLED',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(checkCommandShape(parsed.command)).toBeNull()
  })
})

// ─── Meta targeting coherence ───────────────────────────────────────────────────

describe('parseCommand — meta.adset.update_targeting coherence', () => {
  const base = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.adset.update_targeting' as const,
    adset_id: '120200000000001',
  }

  it('rejects an update with no targeting fields at all', () => {
    const result = parseCommand({ ...base })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/at least one targeting field/)
  })

  it('rejects age_min greater than age_max', () => {
    const result = parseCommand({ ...base, age_min: 40, age_max: 25 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/age_min/)
  })

  it('accepts age_min equal to age_max', () => {
    const result = parseCommand({ ...base, age_min: 30, age_max: 30 })
    expect(result.ok).toBe(true)
  })

  it('accepts a single targeting field on its own', () => {
    expect(parseCommand({ ...base, countries: ['BR', 'US'] }).ok).toBe(true)
    expect(parseCommand({ ...base, genders: [] }).ok).toBe(true)
  })

  it('rejects a country code that is not two uppercase letters', () => {
    expect(parseCommand({ ...base, countries: ['br'] }).ok).toBe(false)
    expect(parseCommand({ ...base, countries: ['BRA'] }).ok).toBe(false)
  })
})

// ─── Strict mode ────────────────────────────────────────────────────────────────
// Every command schema is built with z.object(...).strict() — an extra field
// (a typo, or a client sending a field from a different command type) must be
// rejected, not silently dropped.

describe('parseCommand — strict schemas reject unknown keys', () => {
  it('rejects an extra top-level field on a Google command', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status',
      campaign_id: '111',
      status: 'ENABLED',
      extra_field: 'should not be here',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a field that belongs to a different command of the same resource', () => {
    // daily_budget belongs to set_daily_budget, not set_status.
    const result = parseCommand({
      platform: 'meta',
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_status',
      campaign_id: '120200000000000',
      status: 'ACTIVE',
      daily_budget: 50,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown command type entirely', () => {
    const result = parseCommand({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.campaign.delete',
      campaign_id: '111',
    })
    expect(result.ok).toBe(false)
  })
})
