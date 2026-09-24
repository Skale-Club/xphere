// The action that queues a phone callback.
//
// Two properties matter more than the happy path:
//
//  1. It never dials. If this ever POSTs to api.vapi.ai directly it bypasses
//     the dialling window, the pacing, the demo-org block and — worst —
//     metadata.campaign_contact_id, which is the only way a call result finds
//     its way back to the row. The fetch spy below is the guard.
//
//  2. It inserts the contact BEFORE re-arming the campaign. A campaign that
//     ran dry is 'completed', and the cron tick only selects 'in_progress'.
//     Re-arm first and a tick can land in between, see an empty queue, and
//     complete the campaign again — with this enrolment inside it, never
//     dialled, and nobody looking.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const campaignRow = {
  id: 'camp-pt',
  status: 'completed',
  started_at: '2026-09-01T10:00:00.000Z',
  vapi_assistant_id: 'asst-pt',
  vapi_phone_number_id: 'pn-1',
}

interface Scenario {
  campaign?: Record<string, unknown> | null
  contact?: { dnd_enabled: boolean; dnd_channels: string[] } | null
  insertError?: { code: string; message: string } | null
}

/** Ordered log of every write the executor performed. */
let writes: Array<{ table: string; op: string; payload?: Record<string, unknown> }> = []
let scenario: Scenario = {}

function fakeClient() {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => {
        if (table === 'campaigns') return Promise.resolve({ data: scenario.campaign ?? null, error: null })
        if (table === 'contacts') return Promise.resolve({ data: scenario.contact ?? null, error: null })
        return Promise.resolve({ data: null, error: null })
      },
      insert: (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', payload })
        const error = scenario.insertError ?? null
        const insertChain: Record<string, unknown> = {
          select: () => insertChain,
          maybeSingle: () =>
            Promise.resolve({ data: error ? null : { id: 'cc-1' }, error }),
        }
        return insertChain
      },
      update: (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'update', payload })
        const updateChain: Record<string, unknown> = {
          eq: () => updateChain,
          select: () => updateChain,
          maybeSingle: () => Promise.resolve({ data: { id: 'cc-1' }, error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        }
        return updateChain
      },
    }
    return chain
  }
  return { from }
}

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => fakeClient(),
}))

vi.mock('@/lib/demo/config', () => ({
  isDemoOrg: (orgId: string) => orgId === 'demo-org',
}))

const { executeCampaignEnrollCall } = await import('@/lib/action-engine/executors/campaign-enroll-call')

const base = {
  orgId: 'org-1',
  campaignName: 'NFC callback — PT',
  phone: '+5511987654321',
  name: 'Test Customer',
  contactId: 'contact-1',
  variables: { company_name: 'Barbearia Exemplo', quoted_total: '$590.00', quantity: 60 },
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  writes = []
  scenario = { campaign: { ...campaignRow }, contact: null, insertError: null }
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('the executor must not call out'))
})

describe('executeCampaignEnrollCall', () => {
  it('enrols the contact and never dials', async () => {
    const result = await executeCampaignEnrollCall(base)

    expect(result).toMatchObject({ ok: true, status: 'enrolled', campaignId: 'camp-pt', campaignContactId: 'cc-1' })
    expect(fetchSpy).not.toHaveBeenCalled()

    const insert = writes.find((w) => w.table === 'campaign_contacts' && w.op === 'insert')
    expect(insert?.payload).toMatchObject({
      campaign_id: 'camp-pt',
      organization_id: 'org-1',
      phone: '+5511987654321',
      status: 'pending',
    })
  })

  it('passes the order facts through as strings the robot can read', async () => {
    await executeCampaignEnrollCall(base)
    const insert = writes.find((w) => w.op === 'insert')
    expect(insert?.payload?.custom_data).toEqual({
      company_name: 'Barbearia Exemplo',
      quoted_total: '$590.00',
      quantity: '60',
    })
  })

  it('drops nested values rather than sending Vapi something it cannot interpolate', async () => {
    await executeCampaignEnrollCall({
      ...base,
      variables: { ok: 'yes', nested: { a: 1 }, empty: null },
    })
    expect(writes.find((w) => w.op === 'insert')?.payload?.custom_data).toEqual({ ok: 'yes' })
  })

  it('inserts the contact before re-arming the campaign', async () => {
    await executeCampaignEnrollCall(base)
    const order = writes.map((w) => `${w.table}:${w.op}`)
    expect(order).toEqual(['campaign_contacts:insert', 'campaigns:update'])
  })

  it('wakes a completed campaign without rewriting when it started', async () => {
    await executeCampaignEnrollCall(base)
    const arm = writes.find((w) => w.table === 'campaigns')
    expect(arm?.payload).toMatchObject({ status: 'in_progress', started_at: '2026-09-01T10:00:00.000Z' })
  })

  it('leaves a running campaign alone', async () => {
    scenario.campaign = { ...campaignRow, status: 'in_progress' }
    await executeCampaignEnrollCall(base)
    expect(writes.some((w) => w.table === 'campaigns')).toBe(false)
  })

  it('skips someone already in the queue', async () => {
    scenario.insertError = { code: '23505', message: 'duplicate key' }
    const result = await executeCampaignEnrollCall(base)
    expect(result).toMatchObject({ ok: true, status: 'skipped_duplicate' })
    expect(writes.filter((w) => w.table === 'campaign_contacts' && w.op === 'update')).toHaveLength(0)
  })

  it('requeues an existing row when asked to, clearing the previous attempt', async () => {
    scenario.insertError = { code: '23505', message: 'duplicate key' }
    const result = await executeCampaignEnrollCall({ ...base, onDuplicate: 'requeue' })
    expect(result).toMatchObject({ ok: true, status: 'requeued' })
    const requeue = writes.find((w) => w.table === 'campaign_contacts' && w.op === 'update')
    expect(requeue?.payload).toMatchObject({
      status: 'pending',
      vapi_call_id: null,
      called_at: null,
      completed_at: null,
      retry_count: 0,
      next_attempt_at: null,
    })
  })

  it('honours do-not-disturb — the first such check on the voice path', async () => {
    scenario.contact = { dnd_enabled: true, dnd_channels: ['calls'] }
    const result = await executeCampaignEnrollCall(base)
    expect(result).toMatchObject({ ok: true, status: 'skipped_dnd' })
    expect(writes).toHaveLength(0)
  })

  it('still enrols when do-not-disturb covers a different channel', async () => {
    scenario.contact = { dnd_enabled: true, dnd_channels: ['email'] }
    const result = await executeCampaignEnrollCall(base)
    expect(result.status).toBe('enrolled')
  })

  it('refuses a number that is not dialable', async () => {
    // No country code, too short to dial, and not a number at all. E.164
    // allows 8 digits, so the short case has to be shorter than that.
    for (const phone of ['', '11987654321', '+551198', 'not a phone']) {
      const result = await executeCampaignEnrollCall({ ...base, phone })
      expect(result.status).toBe('skipped_no_phone')
    }
    expect(writes).toHaveLength(0)
  })

  it('accepts a number with spaces and punctuation around it', async () => {
    const result = await executeCampaignEnrollCall({ ...base, phone: ' +55 (11) 98765-4321 ' })
    expect(result.status).toBe('enrolled')
    expect(writes.find((w) => w.op === 'insert')?.payload?.phone).toBe('+5511987654321')
  })

  it('never touches the demo org', async () => {
    const result = await executeCampaignEnrollCall({ ...base, orgId: 'demo-org' })
    expect(result.status).toBe('skipped_demo_org')
    expect(writes).toHaveLength(0)
  })

  it('says so when the campaign does not exist, instead of creating one', async () => {
    scenario.campaign = null
    const result = await executeCampaignEnrollCall(base)
    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('NFC callback')
    expect(writes).toHaveLength(0)
  })

  it('says so when the campaign has no assistant or number, which would dial nothing', async () => {
    scenario.campaign = { ...campaignRow, vapi_assistant_id: null }
    const result = await executeCampaignEnrollCall(base)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('assistant')
    expect(writes).toHaveLength(0)
  })

  it('requires a campaign to be named at all', async () => {
    const result = await executeCampaignEnrollCall({ ...base, campaignName: undefined })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('campaign_id or campaign_name')
  })
})
