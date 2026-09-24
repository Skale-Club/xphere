// Calls one of an assistant's tools the way Vapi does, against production.
//
// Everything else in the voice path can be verified in isolation: the executor
// with a probe, the rendered prompt with a dry run, the conversation with a
// rehearsal. This is the only check that exercises the whole ingress —
// signature, tool resolution, the action engine, the executor, and the shape
// of the answer the assistant will read aloud.
//
// READ-ONLY BY DEFAULT. A tool that writes is refused unless ALLOW_WRITE=1,
// because the far end of this request is the live system: a booking made here
// is a real booking, in somebody's real calendar.
//
//   VOICE_PROBE_ASSISTANT_ID=… VOICE_PROBE_TOOL=check_meeting_times \
//   VOICE_PROBE_ARGS='{"date":"2026-10-01"}' \
//     npx vitest run --config vitest.manual.config.ts tests/manual/voice-tool-call-probe.test.ts

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { assistantServerSecret } from '@/lib/vapi/sync-assistant-config'

const ASSISTANT_ID = process.env.VOICE_PROBE_ASSISTANT_ID
const TOOL = process.env.VOICE_PROBE_TOOL
const ARGS = process.env.VOICE_PROBE_ARGS ?? '{}'
const TOOLS_URL = process.env.VOICE_PROBE_URL ?? 'https://xphere.app/api/vapi/tools'

/** Tools that change something. Naming them here is cheaper than regretting one. */
const WRITE_TOOLS = ['book_meeting', 'create_booking', 'cancel_booking', 'reschedule_booking']

it.skipIf(!ASSISTANT_ID || !TOOL)(
  'a tool call reaches the executor and comes back speakable',
  async () => {
    if (WRITE_TOOLS.some((t) => TOOL!.includes(t)) && process.env.ALLOW_WRITE !== '1') {
      throw new Error(
        `${TOOL} writes to the live system. Re-run with ALLOW_WRITE=1 if that is really what you want.`,
      )
    }

    const supabase = createServiceRoleClient()

    // The secret the assistant itself carries — never invented, never printed.
    const { data: mapping } = await supabase
      .from('assistant_mappings')
      .select('organization_id')
      .eq('vapi_assistant_id', ASSISTANT_ID!)
      .maybeSingle()
    expect(mapping?.organization_id, 'assistant is not mapped to an org').toBeTruthy()

    const { data: integration } = await supabase
      .from('integrations')
      .select('encrypted_api_key')
      .eq('organization_id', mapping!.organization_id)
      .eq('provider', 'vapi')
      .eq('is_active', true)
      .maybeSingle()
    const vapiKey = await decrypt(integration!.encrypted_api_key)

    const assistant = (await (
      await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, {
        headers: { Authorization: `Bearer ${vapiKey}` },
      })
    ).json()) as { server?: unknown; model?: { tools?: { server?: unknown }[] } }

    const secret =
      assistantServerSecret(assistant.server) ??
      (assistant.model?.tools ?? []).map((t) => assistantServerSecret(t.server)).find(Boolean)
    expect(secret, 'no webhook secret on this assistant').toBeTruthy()

    const started = Date.now()
    const response = await fetch(TOOLS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vapi-secret': secret as string },
      body: JSON.stringify({
        message: {
          type: 'tool-calls',
          // A synthetic call id: no artifact, so any tool behind the
          // spoken-consent gate refuses — which is the correct answer here.
          call: { id: `probe-${Date.now()}`, assistantId: ASSISTANT_ID },
          toolCallList: [
            { id: 'probe-tool-call', type: 'function', function: { name: TOOL, arguments: ARGS } },
          ],
        },
      }),
    })

    const elapsed = Date.now() - started
    const body = (await response.json()) as { results?: { toolCallId: string; result: string }[] }
    console.log(`### ${response.status} in ${elapsed}ms`)
    console.log(`### RESULT: ${body.results?.[0]?.result ?? JSON.stringify(body)}`)

    // The tools route must always answer 200 — a non-200 is what makes Vapi
    // retry a tool call, and a retried write is the failure this whole path is
    // built to avoid.
    expect(response.status).toBe(200)
    expect(body.results?.[0]?.toolCallId).toBe('probe-tool-call')
    expect(body.results?.[0]?.result).toBeTruthy()
    expect(body.results?.[0]?.result).not.toMatch(/Tool not configured/i)
  },
  120000,
)
