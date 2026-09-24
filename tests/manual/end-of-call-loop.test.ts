// The closing half of the outbound loop — the half that has never run here.
//
// This org has exactly one `calls` row, from 2026-08-01, still stuck at
// `ringing`. The end-of-call report has never arrived, not once, so nothing has
// ever moved a `campaign_contacts` row off `calling`. Everything upstream is
// proved: the order reaches the queue, the dialler respects the window, the
// assistant answers its tools. This is the last unproved link.
//
// It posts a real end-of-call-report at production, signed with the callback
// assistant's own x-vapi-secret and carrying metadata.campaign_contact_id
// exactly as a campaign call does. That exercises the receiver, the secret
// check, persistCallRecord, updateCampaignContactFromReport and the retry
// policy — everything between "Vapi hung up" and "the row says what happened".
//
// WHAT IT DOES NOT PROVE: that Vapi chooses to SEND the report. That is Vapi's
// behaviour, not ours. The assistants now sit on Vapi's default serverMessages,
// the same setting as the one assistant in this account whose webhooks
// demonstrably work — but only a real call settles it.
//
//   VERIFY_EOC=1 npx vitest run --config vitest.manual.config.ts \
//     tests/manual/end-of-call-loop.test.ts
//
// SAFETY
//   - Pauses the campaign for the duration, so a row requeued by the retry
//     policy cannot be picked up by the cron tick mid-test.
//   - Deletes every queue row it creates and restores the campaign status in a
//     finally block.
//   - Leaves the two synthetic `calls` rows in place deliberately: they are the
//     audit trail, and their transcripts say what they are.

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const ORG = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'
const CAMPAIGN = 'NFC callback — PT'
/** The PT callback assistant — the one a campaign call would come from. */
const ASSISTANT = 'd8b13b3b-980d-4269-a64f-393343a01ad1'
const PHONE = '+5511999990002'
const CALLS_URL = process.env.CALLS_URL ?? 'https://xphere.app/api/vapi/calls'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

it.skipIf(process.env.VERIFY_EOC !== '1')(
  'an end-of-call report moves the queue row off `calling`',
  async () => {
    const supabase = createServiceRoleClient()

    const { data: integ } = await supabase
      .from('integrations')
      .select('encrypted_api_key')
      .eq('organization_id', ORG)
      .eq('provider', 'vapi')
      .eq('is_active', true)
      .maybeSingle()
    const vapiKey = await decrypt(integ!.encrypted_api_key!)
    const assistant = (await (
      await fetch(`https://api.vapi.ai/assistant/${ASSISTANT}`, {
        headers: { Authorization: `Bearer ${vapiKey}` },
      })
    ).json()) as { server?: { headers?: Record<string, string>; secret?: string } }
    const secret = assistant.server?.headers?.['x-vapi-secret'] ?? assistant.server?.secret
    expect(secret, 'the callback assistant carries no x-vapi-secret').toBeTruthy()

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, status, retry_policy')
      .eq('organization_id', ORG)
      .eq('channel', 'calls')
      .eq('name', CAMPAIGN)
      .single()
    const original = campaign!.status
    console.log(`### campaign ${campaign!.id} is ${original}; retry=${JSON.stringify(campaign!.retry_policy)}`)

    const report = (endedReason: string, rowId: string, callId: string, label: string) =>
      fetch(CALLS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vapi-secret': secret! },
        body: JSON.stringify({
          message: {
            type: 'end-of-call-report',
            endedReason,
            startedAt: new Date(Date.now() - 45_000).toISOString(),
            endedAt: new Date().toISOString(),
            cost: 0.0123,
            call: {
              id: callId,
              assistantId: ASSISTANT,
              status: 'ended',
              type: 'outboundPhoneCall',
              metadata: { campaign_contact_id: rowId },
              customer: { number: PHONE, name: 'Synthetic verification' },
            },
            artifact: { transcript: `AI: (${label} — synthetic verification report, no call was placed)` },
            analysis: {
              summary: `Synthetic ${endedReason} report verifying the end-of-call path.`,
              successEvaluation: 'false',
              structuredData: { outcome: 'failed', notes: label },
            },
          },
        }),
      })

    try {
      await supabase.from('campaigns').update({ status: 'paused' }).eq('id', campaign!.id)

      for (const [label, endedReason, expected] of [
        ['no-answer', 'customer-did-not-answer', 'pending'],
        ['answered', 'customer-ended-call', 'completed'],
      ] as const) {
        await supabase.from('campaign_contacts').delete().eq('campaign_id', campaign!.id).eq('phone', PHONE)

        const callId = `verify-${label}-${Date.now()}`
        const { data: row } = await supabase
          .from('campaign_contacts')
          .insert({
            campaign_id: campaign!.id,
            organization_id: ORG,
            name: 'Synthetic verification',
            phone: PHONE,
            status: 'calling',
            vapi_call_id: callId,
            called_at: new Date().toISOString(),
            custom_data: {},
          })
          .select('id')
          .single()

        const res = await report(endedReason, row!.id, callId, label)
        console.log(`\n--- ${label}: POST -> HTTP ${res.status}`)
        expect(res.status).toBe(200)

        // The route does its writing in an after() hook, so poll.
        let settled: Record<string, unknown> | null = null
        for (let i = 0; i < 12; i++) {
          await sleep(2000)
          const { data } = await supabase
            .from('campaign_contacts')
            .select('status, retry_count, next_attempt_at, completed_at')
            .eq('id', row!.id)
            .maybeSingle()
          settled = data
          if (data && data.status !== 'calling') break
        }
        console.log(`### expected ${expected}, got ${JSON.stringify(settled)}`)
        expect(settled?.status).toBe(expected)

        const { data: call } = await supabase
          .from('calls')
          .select('id, ended_reason')
          .eq('vapi_call_id', callId)
          .maybeSingle()
        console.log(`### calls row: ${call ? `${call.id} ${call.ended_reason}` : 'NONE'}`)
        expect(call, 'no `calls` row was written').toBeTruthy()
      }
    } finally {
      await supabase.from('campaign_contacts').delete().eq('campaign_id', campaign!.id).eq('phone', PHONE)
      await supabase.from('campaigns').update({ status: original }).eq('id', campaign!.id)
      const { data: restored } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', campaign!.id)
        .single()
      console.log(`\n### restored to ${restored!.status}; queue rows deleted`)
    }
  },
  180_000,
)
