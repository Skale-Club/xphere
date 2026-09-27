// Skleanings voice reception — idempotent setup.
//
// Rebuilds the phone robot on the platform instead of leaving it loose in the
// Vapi dashboard, which is where it rotted: its prompt referenced six tools
// (add_to_ghl, get_estimates, get_dates, book_appt, end_call_tool,
// transfer_call_tool) and all seven of its toolIds returned 404, so it could
// not quote, book, transfer or even hang up. It also pointed at GoHighLevel,
// which is legacy — everything lives in Xphere now.
//
// The replacement is the configuration that already works for Cuts & Culture in
// this same account: the eight Xkedule tools, which read the real catalogue,
// price real jobs and write real bookings against skleanings.com.
//
//   npx tsx --env-file=.env.local scripts/setup-skleanings-voice.ts          # dry run
//   npx tsx --env-file=.env.local scripts/setup-skleanings-voice.ts --apply

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const ORG_ID = '24552ef3-de77-4fba-a2c3-148cd58d8750'
/** `Sky | Skleanings | V2`, the one bound to a phone number today. */
const ASSISTANT_ID = '7dc23636-a684-48f7-a82f-37062c5b5d00'

const AGENT = {
  slug: 'voice-reception',
  name: 'Voice — Skleanings reception',
  description:
    'Answers the Skleanings phone line: works out what the caller wants cleaned, prices it from the real ' +
    'catalogue, offers real open times and books the job at the customer’s address. Never quotes a figure ' +
    'a tool did not return.',
  promptFile: 'reception.md',
  persona: 'Sky',
  // {{business_name}} is substituted by the renderer; {{PERSONA}} is not — it
  // is a placeholder the prompt file uses, and the dry run caught it being read
  // out to callers verbatim.
  firstMessage: 'Hi, this is Sky at {{business_name}} — how can I help?',
  idleMessages: ['Still here whenever you are ready.'],
  keyterms: [
    'Skleanings', 'Framingham', 'deep clean', 'move in', 'move out', 'sofa', 'couch', 'loveseat',
    'sectional', 'armchair', 'carpet', 'rug', 'mattress', 'upholstery', 'stairs', 'hallway',
    'bedroom', 'bathroom', 'studio', 'quote', 'estimate',
  ],
  tools: [
    'business_info',
    'list_services',
    'get_quote',
    'check_availability',
    'lookup_customer',
    'book_appointment',
    'reschedule_appointment',
    'cancel_appointment',
  ],
  analysisOutcomes: [
    'booked',
    'quoted_no_booking',
    'question_answered',
    'existing_customer_issue',
    'rescheduled',
    'cancelled',
    'wrong_number',
    'abandoned',
    'failed',
  ],
  analysisScope: 'what this cleaning company sells: services, prices, availability and bookings',
  analysisRubric:
    'The call passes only if the assistant stayed inside what a tool told it: it never invented a price, an ' +
    'opening hour, an available time or a policy, it read the job and the address back before booking, and it ' +
    'either booked, answered the question, or took a message. Answer Pass or Fail.',
  fallbackMessage: 'Let me take your details and have someone from the team call you back.',
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sb = createServiceRoleClient()
  const say = (s: string) => console.log(s)

  // {{PERSONA}} is a placeholder this repo uses in prompt files, not something
  // the renderer or Vapi resolves — left in, the assistant is literally told
  // "You are {{PERSONA}}". The date/time tokens the prompt needs are injected
  // by the renderer as Vapi Liquid, so the prompt file must not write its own.
  const systemPrompt = readFileSync(join(process.cwd(), 'scripts', 'skleanings-voice', AGENT.promptFile), 'utf8')
    .replace(/\{\{\s*PERSONA\s*\}\}/g, AGENT.persona)
  // business_name IS resolved by the renderer, so it belongs in the file.
  const leftover = systemPrompt.match(/\{\{\s*(PERSONA|now|timezone)\s*\}\}/g)
  if (leftover) throw new Error(`prompt still carries ${[...new Set(leftover)].join(', ')}`)
  say(`prompt: ${systemPrompt.length} chars`)

  // The Xkedule credential everything hangs off. Without it the tools resolve
  // to nothing and we are back where we started.
  const { data: integration } = await sb
    .from('integrations')
    .select('id, location_id, is_active')
    .eq('organization_id', ORG_ID)
    .eq('provider', 'xkedule')
    .maybeSingle()
  if (!integration?.is_active) throw new Error('No active Xkedule integration for this org — mint a key first')
  say(`xkedule: ${integration.location_id}`)

  const config = {
    name: AGENT.name,
    description: AGENT.description,
    model: 'anthropic/claude-sonnet-4-6',
    temperature: 0.3,
    max_tokens: 500,
    max_history: 20,
    fallback_message: AGENT.fallbackMessage,
    is_active: true,
    allowed_channels: ['voice'],
    kb_scope: [] as string[],
    channel_overrides: {
      voice: {
        first_message: AGENT.firstMessage,
        language: 'en',
        keyterms: AGENT.keyterms,
        idle_messages: AGENT.idleMessages,
        // This one DOES book, at the customer's address, so the appointment
        // blocks belong in the rendered prompt.
        appointments: true,
        analysis: {
          outcomes: AGENT.analysisOutcomes,
          scope: AGENT.analysisScope,
          rubric: AGENT.analysisRubric,
        },
      },
    },
  }

  const { data: existing } = await sb
    .from('agents')
    .select('id, system_prompt, active_prompt_version_id')
    .eq('organization_id', ORG_ID)
    .eq('slug', AGENT.slug)
    .maybeSingle()

  if (!apply) {
    say(`\nWOULD ${existing ? 'update' : 'create'} agent ${AGENT.slug}`)
    say(`WOULD grant ${AGENT.tools.length} tools`)
    say(`WOULD bind assistant ${ASSISTANT_ID} to it`)
    say('\nDRY RUN — pass --apply.')
    return
  }

  let agentId = existing?.id
  if (agentId) {
    const { error } = await sb.from('agents').update(config).eq('id', agentId)
    if (error) throw error
    say(`updated agent ${agentId}`)
  } else {
    const { data, error } = await sb
      .from('agents')
      // system_prompt is NOT NULL, but the version-history trigger only fires
      // on UPDATE. Insert a placeholder so the real prompt lands as an UPDATE
      // below and gets a version row — inserting the real one directly leaves
      // the agent with no published version at all.
      .insert({ organization_id: ORG_ID, slug: AGENT.slug, system_prompt: '(pending)', ...config })
      .select('id')
      .single()
    if (error) throw error
    agentId = data.id
    say(`created agent ${agentId}`)
  }

  if (existing?.system_prompt !== systemPrompt || !existing?.active_prompt_version_id) {
    // The trigger fires on a CHANGE to system_prompt. If the column already
    // holds this exact text but no version was ever published (which is what an
    // insert leaves behind), writing the same value again is a no-op and no
    // version appears. Step through a placeholder so the real write is a change.
    const { data: current } = await sb.from('agents').select('system_prompt').eq('id', agentId).single()
    if (current?.system_prompt === systemPrompt) {
      const { error } = await sb.from('agents').update({ system_prompt: '(publishing)' }).eq('id', agentId)
      if (error) throw error
    }
    const { error: pErr } = await sb.from('agents').update({ system_prompt: systemPrompt }).eq('id', agentId)
    if (pErr) throw pErr
    const { data: version, error: vErr } = await sb
      .from('agent_prompt_versions')
      .select('id, version, system_prompt')
      .eq('agent_id', agentId)
      .order('version', { ascending: false })
      .limit(1)
      .single()
    if (vErr || !version || version.system_prompt !== systemPrompt) {
      throw new Error('Prompt version row not created — check the migration 045 trigger')
    }
    const { error } = await sb.from('agents').update({ active_prompt_version_id: version.id }).eq('id', agentId)
    if (error) throw error
    say(`published prompt version ${version.version}`)
  } else {
    say('prompt unchanged')
  }

  for (const toolName of AGENT.tools) {
    const { data: workflow } = await sb
      .from('workflows')
      .select('id')
      .eq('org_id', ORG_ID)
      .eq('tool_name', toolName)
      .maybeSingle()
    if (!workflow) {
      say(`WARNING: no workflow named "${toolName}" — skipped`)
      continue
    }
    const { data: grant } = await sb
      .from('agent_tools')
      .select('id')
      .eq('agent_id', agentId)
      .eq('workflow_id', workflow.id)
      .maybeSingle()
    if (grant) {
      say(`tool ${toolName} already granted`)
      continue
    }
    const { error } = await sb
      .from('agent_tools')
      .insert({ organization_id: ORG_ID, agent_id: agentId, workflow_id: workflow.id })
    if (error) throw error
    say(`granted tool ${toolName}`)
  }

  const { data: mapping } = await sb
    .from('assistant_mappings')
    .select('id, entry_agent_id')
    .eq('organization_id', ORG_ID)
    .eq('vapi_assistant_id', ASSISTANT_ID)
    .maybeSingle()
  if (!mapping) throw new Error(`No assistant_mappings row for ${ASSISTANT_ID} — run Sync from Vapi first`)
  if (mapping.entry_agent_id === agentId) {
    say('assistant already bound')
  } else {
    const { error } = await sb.from('assistant_mappings').update({ entry_agent_id: agentId }).eq('id', mapping.id)
    if (error) throw error
    say(`bound assistant ${ASSISTANT_ID} to ${AGENT.slug}`)
  }

  say('\ndone. Push to Vapi from Calls -> Voice settings -> Assistants, or with pushAssistantConfig.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
