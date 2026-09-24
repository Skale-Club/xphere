// Would pushing change anything? Renders the PATCH body with dryRun and diffs
// it field by field against what the live assistant already carries.
//
// This exists because a dry run used to be blind to most of what it writes:
// `rendered` covers the prompt, the function schemas and the per-tool
// messages, while the greeting, the voice, the transcriber and the
// speaking/analysis plans were assembled afterwards and never surfaced. A
// change to any of those could reach a phone-answering assistant with nobody
// having read it.
//
// Use it as a fence around refactors of sync-assistant-config.ts: run it
// against a live tenant BEFORE the change, keep the output, run it after, and
// require the same verdict. An empty diff means that tenant's assistant would
// be PATCHed with exactly what it already has.
//
// Read-only: no PATCH, no UPDATE. Excluded from the default vitest glob.
//
//   VAPI_PUSH_TEST_ORG_ID=… VAPI_PUSH_TEST_ASSISTANT_ID=… \
//     npx vitest run --config vitest.manual.config.ts tests/manual/vapi-push-diff.test.ts

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { pushAssistantConfig } from '@/lib/vapi/sync-assistant-config'

const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const ASSISTANT_ID = process.env.VAPI_PUSH_TEST_ASSISTANT_ID
/** Set STRICT=1 to fail the run on any difference, not just report it. */
const STRICT = process.env.STRICT === '1'

/** Fields the push owns. Anything else on the assistant is none of its business. */
const PUSHED_FIELDS = [
  'firstMessage',
  'firstMessageMode',
  'voice',
  'transcriber',
  'startSpeakingPlan',
  'stopSpeakingPlan',
  'backgroundSpeechDenoisingPlan',
  'messagePlan',
  'analysisPlan',
  'server',
] as const

/** Stable stringify so key order never shows up as a difference. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

it.skipIf(!ORG_ID || !ASSISTANT_ID)(
  'diffs the rendered PATCH against the live assistant',
  async () => {
    const supabase = createServiceRoleClient()

    const result = await pushAssistantConfig(supabase, ORG_ID!, ASSISTANT_ID!, { dryRun: true })
    if (!result.ok) throw new Error(result.error)
    const patch = result.patch!
    console.log('### PROMPT SOURCE: ' + result.agentSource)

    const { data: integration } = await supabase
      .from('integrations')
      .select('encrypted_api_key')
      .eq('organization_id', ORG_ID!)
      .eq('provider', 'vapi')
      .eq('is_active', true)
      .maybeSingle()
    if (!integration) throw new Error('Vapi integration not connected for this org.')

    const key = await decrypt(integration.encrypted_api_key)
    const res = await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) throw new Error(`Vapi GET /assistant returned ${res.status}`)
    const live = (await res.json()) as Record<string, unknown>

    const differences: string[] = []

    // The prompt and the tool list live under `model`, beside provider/model
    // fields the push deliberately carries over untouched.
    const liveModel = (live.model ?? {}) as Record<string, unknown>
    const patchModel = (patch.model ?? {}) as Record<string, unknown>

    const livePrompt = (liveModel.messages as { role?: string; content?: string }[] | undefined)
      ?.find((m) => m.role === 'system')?.content ?? ''
    const patchPrompt = (patchModel.messages as { role?: string; content?: string }[] | undefined)
      ?.find((m) => m.role === 'system')?.content ?? ''
    if (livePrompt !== patchPrompt) {
      differences.push('model.messages[system]')
      console.log('### PROMPT DIFF: live ' + livePrompt.length + ' chars, patch ' + patchPrompt.length + ' chars')
    }

    const toolNames = (tools: unknown) =>
      ((tools ?? []) as { function?: { name?: string } }[]).map((t) => t.function?.name ?? '?').sort()
    if (canonical(toolNames(liveModel.tools)) !== canonical(toolNames(patchModel.tools))) {
      differences.push('model.tools[names]')
      console.log('### LIVE TOOLS: ' + toolNames(liveModel.tools).join(','))
      console.log('### PATCH TOOLS: ' + toolNames(patchModel.tools).join(','))
    }
    if (liveModel.maxTokens !== patchModel.maxTokens) {
      differences.push(`model.maxTokens (${String(liveModel.maxTokens)} -> ${String(patchModel.maxTokens)})`)
    }

    for (const field of PUSHED_FIELDS) {
      if (!(field in patch)) continue // the push leaves this one alone
      const before = canonical(live[field])
      const after = canonical(patch[field])
      if (before !== after) {
        differences.push(field)
        console.log(`### ${field} LIVE : ${before}`)
        console.log(`### ${field} PATCH: ${after}`)
      }
    }

    if (differences.length === 0) {
      console.log('### NO DIFFERENCE — this push would be a no-op.')
    } else {
      console.log('### DIFFERS IN: ' + differences.join(', '))
    }

    if (STRICT) expect(differences).toEqual([])
  },
  120000
)
