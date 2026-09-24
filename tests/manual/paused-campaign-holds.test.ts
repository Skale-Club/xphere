// Pausing a campaign has to actually stop it.
//
// This is the regression that shipped: the enrolment action re-armed any
// campaign that was not already 'in_progress', so an operator who paused to
// stop the phone ringing — which is what the runbook tells them to do — had it
// woken again by the next order off the website. Nobody touched the campaign;
// it simply started dialling again.
//
// The unit test covers the logic against a fake client. This one runs the real
// executor against the real database, because the thing that was wrong was a
// query, and a query is only ever really tested by a database.
//
//   VERIFY_PAUSE=1 npx vitest run --config vitest.manual.config.ts \
//     tests/manual/paused-campaign-holds.test.ts
//
// SAFETY
//   - It pauses a live campaign for the length of the test and restores the
//     previous status in a finally block, whatever happens.
//   - It enrols a reserved, unroutable number, and deletes that row afterwards.
//   - If the assertion fails, the campaign was re-armed by the executor — check
//     that the deployed image actually carries the fix before rerunning.

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeCampaignEnrollCall } from '@/lib/action-engine/executors/campaign-enroll-call'

const ORG_ID = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'
const CAMPAIGN = 'NFC callback — PT'
/** Reserved by ITU for documentation; it cannot be connected. */
const PHONE = '+15555550100'

it.skipIf(process.env.VERIFY_PAUSE !== '1')(
  'an enrolment queues behind a paused campaign instead of waking it',
  async () => {
    const supabase = createServiceRoleClient()

    const { data: before } = await supabase
      .from('campaigns')
      .select('id, status')
      .eq('organization_id', ORG_ID)
      .eq('channel', 'calls')
      .eq('name', CAMPAIGN)
      .single()
    expect(before, `no campaign named ${CAMPAIGN}`).toBeTruthy()
    const original = before!.status
    console.log(`### campaign ${before!.id} is currently ${original}`)

    try {
      await supabase.from('campaigns').update({ status: 'paused' }).eq('id', before!.id)
      console.log('### paused')

      const result = await executeCampaignEnrollCall({
        orgId: ORG_ID,
        campaignName: CAMPAIGN,
        phone: PHONE,
        name: 'Pause check (manual test)',
        onDuplicate: 'requeue',
        variables: { customer_name: 'Pause check', quoted_total: '$0.00' },
      })
      console.log('### enrolment:', JSON.stringify(result))

      // It enrolled — the queue still accepts work while paused, which is the
      // documented behaviour.
      expect(result.ok).toBe(true)
      expect(['enrolled', 'requeued']).toContain(result.status)

      const { data: after } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', before!.id)
        .single()
      console.log(`### campaign after enrolment: ${after!.status}`)

      // The whole point.
      expect(after!.status).toBe('paused')

      const { data: row } = await supabase
        .from('campaign_contacts')
        .select('status')
        .eq('campaign_id', before!.id)
        .eq('phone', PHONE)
        .maybeSingle()
      console.log(`### queued row: ${row?.status}`)
      expect(row?.status).toBe('pending')
    } finally {
      await supabase.from('campaign_contacts').delete().eq('campaign_id', before!.id).eq('phone', PHONE)
      await supabase.from('campaigns').update({ status: original }).eq('id', before!.id)
      const { data: restored } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', before!.id)
        .single()
      console.log(`### restored to ${restored!.status}, test row deleted`)
    }
  },
  60_000,
)
