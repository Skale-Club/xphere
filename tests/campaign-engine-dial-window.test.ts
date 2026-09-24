// The dialler's two new refusals, at the level where they protect a real
// phone ringing at a real hour.
//
// The second test is the subtle one: a campaign waiting for its window must
// not COMPLETE itself while it waits. The window check therefore sits before
// the candidate fetch, so checkAndCompleteCampaign() is never reached. Put it
// after, and an evergreen callback campaign with an empty queue quietly
// finishes overnight — the cron tick stops selecting it, and every order that
// arrives the next morning is enrolled into a campaign that never dials.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

interface EngineScenario {
  campaign: Record<string, unknown>
  pendingContacts: Array<{ id: string }>
}

let scenario: EngineScenario
let writes: Array<{ table: string; payload: Record<string, unknown> }> = []

function fakeClient() {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      or: () => chain,
      limit: () =>
        Promise.resolve({ data: table === 'campaign_contacts' ? scenario.pendingContacts : [], error: null }),
      single: () => Promise.resolve({ data: scenario.campaign, error: null }),
      maybeSingle: () => Promise.resolve({ data: scenario.campaign, error: null }),
      update: (payload: Record<string, unknown>) => {
        writes.push({ table, payload })
        const updateChain: Record<string, unknown> = {
          eq: () => updateChain,
          in: () => updateChain,
          select: () => Promise.resolve({ data: [], error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        }
        return updateChain
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
    }
    return chain
  }
  return { from } as never
}

vi.mock('@/lib/demo/config', () => ({ isDemoOrg: () => false }))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}))
const createOutboundCall = vi.fn(async () => ({ vapiCallId: 'call-1' }))
vi.mock('@/lib/campaigns/outbound', () => ({ createOutboundCall }))

const { startCampaignBatch } = await import('@/lib/campaigns/engine')

const BUSINESS_HOURS = {
  timezone: 'America/Sao_Paulo',
  days: { monday: [['09:00', '18:00']], thursday: [['09:00', '18:00']] },
}

beforeEach(() => {
  writes = []
  createOutboundCall.mockClear()
  scenario = {
    campaign: {
      id: 'camp-pt',
      organization_id: 'org-1',
      status: 'in_progress',
      vapi_assistant_id: 'asst-pt',
      vapi_phone_number_id: 'pn-1',
      calls_per_minute: 2,
      dial_window: BUSINESS_HOURS,
      is_evergreen: true,
    },
    pendingContacts: [{ id: 'cc-1' }],
  }
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startCampaignBatch and the dialling window', () => {
  it('dials inside the window', async () => {
    vi.setSystemTime(new Date('2026-09-24T13:00:00Z')) // 10:00 in São Paulo, a Thursday
    const result = await startCampaignBatch('camp-pt', fakeClient(), 'key')
    expect(result.skippedDialWindow).toBeUndefined()
  })

  it('dials nothing outside the window, and says why', async () => {
    vi.setSystemTime(new Date('2026-09-25T04:00:00Z')) // 01:00 local
    const result = await startCampaignBatch('camp-pt', fakeClient(), 'key')

    expect(result).toEqual({ fired: 0, errors: 0, skippedDialWindow: true })
    expect(createOutboundCall).not.toHaveBeenCalled()
  })

  it('does not complete a campaign that is merely waiting for its window', async () => {
    vi.setSystemTime(new Date('2026-09-25T04:00:00Z'))
    scenario.pendingContacts = [] // queue is empty right now
    await startCampaignBatch('camp-pt', fakeClient(), 'key')

    expect(writes.some((w) => w.table === 'campaigns' && w.payload.status === 'completed')).toBe(false)
  })

  it('does not complete an evergreen campaign inside the window either', async () => {
    vi.setSystemTime(new Date('2026-09-24T13:00:00Z'))
    scenario.pendingContacts = []
    await startCampaignBatch('camp-pt', fakeClient(), 'key')

    expect(writes.some((w) => w.table === 'campaigns' && w.payload.status === 'completed')).toBe(false)
  })

  it('still completes an ordinary campaign whose queue has emptied', async () => {
    vi.setSystemTime(new Date('2026-09-24T13:00:00Z'))
    scenario.campaign.is_evergreen = false
    scenario.pendingContacts = []
    await startCampaignBatch('camp-pt', fakeClient(), 'key')

    expect(writes.some((w) => w.table === 'campaigns' && w.payload.status === 'completed')).toBe(true)
  })

  it('dials any time when no window is configured — every campaign before 1301', async () => {
    vi.setSystemTime(new Date('2026-09-25T04:00:00Z'))
    scenario.campaign.dial_window = {}
    const result = await startCampaignBatch('camp-pt', fakeClient(), 'key')
    expect(result.skippedDialWindow).toBeUndefined()
  })
})
