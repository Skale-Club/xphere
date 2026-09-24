// Redialling someone who did not answer.
//
// The default is deliberately "no". The campaign-tick route says why in its
// own header — re-dialling automatically has consent implications — so the
// behaviour is off until a campaign carries a retry_policy, and every campaign
// that existed before migration 1301 carries `{}`.
//
// Voicemail is excluded on purpose: mapEndedReasonToStatus folds it into
// no_answer, but calling back someone whose voicemail you just filled is worse
// than not calling at all.

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface RetryScenario {
  retryPolicy: Record<string, unknown>
  retryCount: number
  isEvergreen: boolean
  pendingOrCalling: number
}

let scenario: RetryScenario
let contactUpdate: Record<string, unknown> | null = null
let campaignUpdate: Record<string, unknown> | null = null

function fakeClient() {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      maybeSingle: () => {
        if (table === 'campaign_contacts') {
          return Promise.resolve({ data: { retry_count: scenario.retryCount, campaign_id: 'camp-1' }, error: null })
        }
        return Promise.resolve({
          data: { retry_policy: scenario.retryPolicy, is_evergreen: scenario.isEvergreen },
          error: null,
        })
      },
      single: () => Promise.resolve({ data: { campaign_id: 'camp-1' }, error: null }),
      update: (payload: Record<string, unknown>) => {
        if (table === 'campaign_contacts') contactUpdate = payload
        if (table === 'campaigns') campaignUpdate = payload
        const updateChain: Record<string, unknown> = {
          eq: () => updateChain,
          select: () => updateChain,
          single: () => Promise.resolve({ data: { campaign_id: 'camp-1' }, error: null }),
          maybeSingle: () => Promise.resolve({ data: { campaign_id: 'camp-1' }, error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        }
        return updateChain
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: scenario.pendingOrCalling }).then(resolve),
    }
    return chain
  }
  return { from } as never
}

vi.mock('@/lib/obs/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  obs: { info: () => {}, warn: () => {}, error: () => {} },
}))

const { updateCampaignContactFromReport } = await import('@/lib/vapi/end-of-call')

const report = (endedReason: string) => ({
  campaignContactId: 'cc-1',
  vapiCallId: 'call-1',
  endedReason,
})

beforeEach(() => {
  contactUpdate = null
  campaignUpdate = null
  scenario = { retryPolicy: {}, retryCount: 0, isEvergreen: false, pendingOrCalling: 1 }
})

describe('auto-completing the campaign when its queue empties', () => {
  it('completes an ordinary campaign', async () => {
    scenario.pendingOrCalling = 0
    await updateCampaignContactFromReport(report('customer-ended-call'), fakeClient())
    expect(campaignUpdate).toMatchObject({ status: 'completed' })
  })

  it('leaves an evergreen campaign open — an empty queue is not the end of it', async () => {
    // A standing callback queue that completes itself stops being selected by
    // the cron tick, and every order that arrives afterwards sits in it unseen
    // until something wakes it up again.
    scenario.pendingOrCalling = 0
    scenario.isEvergreen = true
    await updateCampaignContactFromReport(report('customer-ended-call'), fakeClient())
    expect(campaignUpdate).toBeNull()
  })
})

describe('no-answer with no retry policy — every campaign before 1301', () => {
  it('leaves the contact as no_answer', async () => {
    await updateCampaignContactFromReport(report('customer-did-not-answer'), fakeClient())
    expect(contactUpdate).toMatchObject({ status: 'no_answer' })
    expect(contactUpdate).not.toHaveProperty('next_attempt_at')
  })

  it('still records a completed call as completed', async () => {
    await updateCampaignContactFromReport(report('customer-ended-call'), fakeClient())
    expect(contactUpdate).toMatchObject({ status: 'completed' })
  })
})

describe('no-answer with a retry policy', () => {
  beforeEach(() => {
    scenario.retryPolicy = { no_answer_max: 2, backoff_minutes: [30, 240] }
  })

  it('puts the contact back in the queue, due after the first backoff', async () => {
    const before = Date.now()
    await updateCampaignContactFromReport(report('customer-did-not-answer'), fakeClient())

    expect(contactUpdate).toMatchObject({ status: 'pending', retry_count: 1 })
    const due = new Date(contactUpdate!.next_attempt_at as string).getTime()
    expect(due - before).toBeGreaterThanOrEqual(29 * 60_000)
    expect(due - before).toBeLessThanOrEqual(31 * 60_000)
  })

  it('uses the second backoff for the second attempt', async () => {
    scenario.retryCount = 1
    const before = Date.now()
    await updateCampaignContactFromReport(report('customer-busy'), fakeClient())

    expect(contactUpdate).toMatchObject({ status: 'pending', retry_count: 2 })
    const due = new Date(contactUpdate!.next_attempt_at as string).getTime()
    expect(due - before).toBeGreaterThanOrEqual(239 * 60_000)
  })

  it('gives up once the attempts are used', async () => {
    scenario.retryCount = 2
    await updateCampaignContactFromReport(report('customer-did-not-answer'), fakeClient())
    expect(contactUpdate).toMatchObject({ status: 'no_answer' })
  })

  it('is clamped by the retry_count CHECK from migration 005, whatever the policy asks for', async () => {
    scenario.retryPolicy = { no_answer_max: 99 }
    scenario.retryCount = 2
    await updateCampaignContactFromReport(report('customer-did-not-answer'), fakeClient())
    expect(contactUpdate).toMatchObject({ status: 'no_answer' })
  })

  it('never redials a voicemail it just filled', async () => {
    await updateCampaignContactFromReport(report('voicemail'), fakeClient())
    expect(contactUpdate).toMatchObject({ status: 'no_answer' })
    expect(contactUpdate).not.toHaveProperty('next_attempt_at')
  })

  it('does not retry a failed call — only an unanswered one', async () => {
    await updateCampaignContactFromReport(report('pipeline-error-openai-llm-failed'), fakeClient())
    expect(contactUpdate).toMatchObject({ status: 'failed' })
  })
})
