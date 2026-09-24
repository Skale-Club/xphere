#!/usr/bin/env node
// Provisions Skale Club's outbound voice: the two order-confirmation robots
// (PT and EN) that call someone back after they order NFC keychains.
//
// Idempotent. Re-running updates what exists and only publishes a new prompt
// version when the prompt text changed.
//
//   npx tsx --env-file=.env.local scripts/setup-skaleclub-voice.ts            # dry run
//   npx tsx --env-file=.env.local scripts/setup-skaleclub-voice.ts --apply
//
// What it creates, in order:
//
//   1. Two Vapi assistants, if they are not there yet, each carrying the
//      assistant-level server block (https://xphere.app/api/vapi/calls) with
//      the org's existing webhook secret. Without that block the end-of-call
//      report never comes back and campaign_contacts rows stay stuck on
//      'calling' forever — the failure looks like "the robot called and
//      nothing happened".
//   2. Two Xphere agents holding the prompts, with their voice options
//      (greeting, spoken language, keyterms, post-call rubric) in
//      channel_overrides.voice.
//   3. assistant_mappings rows binding each assistant to its agent, which is
//      what lets one org have more than one voice persona.
//   4. Two evergreen campaigns with a business-hours dialling window, which
//      the campaign_enroll_call workflow action enrols into.
//
// It never pushes a config to Vapi: run the dry-run diff first, then push from
// Calls -> Voice settings -> Assistants, or with
// tests/manual/vapi-push-assistant-config.test.ts.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '../src/lib/crypto'
import type { Database } from '../src/types/database'

const SKALE_CLUB_ORG_ID = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'
const CALLS_SERVER_URL = 'https://xphere.app/api/vapi/calls'
/** The only Vapi-native number the org owns; it is the caller id for both campaigns. */
const CALLER_ID_E164 = '+13128780637'

/** Same model the other tenant's live phone assistant runs on. */
const MODEL = { provider: 'openrouter', model: 'openai/gpt-5.1' }

interface VoicePersona {
  slug: string
  name: string
  description: string
  promptFile: string
  assistantName: string
  /** Bind to an assistant that already exists instead of creating one. */
  existingAssistantId?: string
  /** Outbound personas get a standing queue; the one that ANSWERS does not. */
  campaignName?: string
  /** IANA zone the campaign's business hours are quoted in. */
  timezone?: string
  language: string
  firstMessage: string
  idleMessages: string[]
  keyterms: string[]
  analysisOutcomes: string[]
  analysisScope: string
  analysisRubric: string
  fallbackMessage: string
  persona: string
  /** Workflow tool_names this agent may call during a call. */
  tools?: string[]
  /** Channels the agent serves. Voice only, unless stated. */
  allowedChannels?: string[]
  /**
   * A specialist this persona may hand the call to. The push carries the
   * partner's granted tools onto the same assistant, so the caller hears one
   * voice while the work belongs to whichever agent owns it.
   */
  partner?: {
    slug: string
    /** What the orchestrator reads to decide when to hand over. */
    invocationDescription: string
    /** tool_names the partner is allowed to use on this edge. */
    workflowGrants: string[]
  }
  /** This persona exists to be delegated to; it is not bound to an assistant. */
  specialistOnly?: boolean
}

const CALLBACK_OUTCOMES = [
  'confirmed',
  'corrected',
  'declined',
  'callback_requested',
  'message_taken',
  'abandoned',
  'failed',
]

const PERSONAS: VoicePersona[] = [
  {
    slug: 'voice-nfc-callback-pt',
    name: 'Voice — NFC order confirmation (PT)',
    description:
      'Calls someone who ordered NFC keychains on the site and confirms the order before production starts. ' +
      'Confirmation only: no selling, no price negotiation, no booking.',
    promptFile: 'callback-pt.md',
    assistantName: 'Skale Club | NFC Callback | PT',
    campaignName: 'NFC callback — PT',
    timezone: 'America/Sao_Paulo',
    language: 'pt',
    persona: 'Sky',
    firstMessage: 'Oi! Aqui é a {{business_name}}, sobre o pedido de chaveiros que você fez agora há pouco.',
    idleMessages: ['Estou aqui quando você quiser continuar.'],
    keyterms: ['chaveiro', 'chaveiros', 'NFC', 'logo', 'arte', 'frete', 'pedido', 'entrega', 'Skale Club'],
    analysisOutcomes: CALLBACK_OUTCOMES,
    analysisScope: 'this keychain order: quantity, style, artwork, price and where it ships',
    analysisRubric:
      'The call passes only if the assistant confirmed this order and nothing else: it read the order back, never ' +
      'invented a price, a lead time or a delivery date, never revealed anything about another customer, and either ' +
      'got a yes-or-no on the details or handed the customer to the team. Answer Pass or Fail.',
    fallbackMessage: 'Vou pedir para alguém da equipe falar com você pelo WhatsApp.',
  },
  {
    slug: 'voice-nfc-callback-en',
    name: 'Voice — NFC order confirmation (EN)',
    description:
      'Calls someone who ordered NFC keychains on the site and confirms the order before production starts. ' +
      'Confirmation only: no selling, no price negotiation, no booking.',
    promptFile: 'callback-en.md',
    assistantName: 'Skale Club | NFC Callback | EN',
    campaignName: 'NFC callback — EN',
    timezone: 'America/New_York',
    language: 'en',
    persona: 'Sky',
    firstMessage: 'Hi! This is {{business_name}}, calling about the keychain order you just placed.',
    idleMessages: ["Take your time — I'm here when you're ready."],
    keyterms: ['keychain', 'keychains', 'NFC', 'logo', 'artwork', 'shipping', 'order', 'Skale Club'],
    analysisOutcomes: CALLBACK_OUTCOMES,
    analysisScope: 'this keychain order: quantity, style, artwork, price and where it ships',
    analysisRubric:
      'The call passes only if the assistant confirmed this order and nothing else: it read the order back, never ' +
      'invented a price, a lead time or a delivery date, never revealed anything about another customer, and either ' +
      'got a yes-or-no on the details or handed the customer to the team. Answer Pass or Fail.',
    fallbackMessage: 'Let me have someone from the team follow up with you on WhatsApp.',
  },
  {
    // Delegated to, never bound to an assistant of its own: the caller stays
    // on the same line and hears the same voice.
    slug: 'voice-scheduling',
    name: 'Voice — scheduling specialist',
    description:
      'Books the 30-minute intro video call on the Xphere calendar. Reception hands the call over ' +
      'when the caller wants to speak to someone on the team.',
    promptFile: 'booking.md',
    assistantName: '(delegated)',
    specialistOnly: true,
    language: 'multi',
    persona: 'Sky',
    firstMessage: '(unused — this agent never answers a call itself)',
    idleMessages: [],
    keyterms: [],
    analysisOutcomes: ['booked', 'message_taken', 'abandoned', 'failed'],
    analysisScope: 'booking the intro call',
    analysisRubric: 'Unused: this agent never owns an assistant.',
    fallbackMessage: 'Vou deixar isso registrado para o time marcar com você.',
    tools: ['check_meeting_times', 'book_meeting'],
  },
  {
    // The one that ANSWERS. It has no campaign: nobody enrols into a phone
    // that rings on its own.
    slug: 'voice-reception',
    name: 'Voice — Skale Club reception',
    description:
      'Answers the Skale Club phone line in general: works out who is calling and what they want, covers ' +
      'the basics on products and services, logs the call to the CRM and hands off to the team. NFC keychains ' +
      'are one subject among many, and everything about them is an estimate.',
    promptFile: 'reception.md',
    assistantName: 'Skale Club | Receptionist | PT-EN',
    existingAssistantId: '80dd9b79-fd39-457c-834a-7b0dd217fee4',
    // Deepgram nova-3 multilingual: whoever calls is answered in their own
    // language without anyone choosing one beforehand.
    language: 'multi',
    persona: 'Sky',
    firstMessage:
      'Thanks for calling {{business_name}}, this is Sky — how can I help? Se preferir português, é só falar.',
    idleMessages: ['Still here whenever you are ready. / Estou aqui quando você quiser.'],
    keyterms: [
      'Skale Club', 'Xkedule', 'Xtimator', 'Xphere', 'Xareable', 'Xsites', 'Xcraper', 'XmartMenu',
      'chaveiro', 'chaveiros', 'keychain', 'NFC', 'website', 'site', 'anúncios', 'ads', 'automação',
      'automation', 'orçamento', 'quote',
    ],
    analysisOutcomes: [
      'message_taken',
      'question_answered',
      'sent_to_order_page',
      'existing_customer_issue',
      'wrong_number',
      'abandoned',
      'failed',
    ],
    analysisScope:
      "what Skale Club sells and who is calling: products, services, keychains, and taking a message",
    analysisRubric:
      'The call passes only if the assistant stayed on what Skale Club does, quoted no price beyond the ' +
      'published product list, promised no date, deadline or result, treated anything about keychains as ' +
      'an estimate, never offered a meeting time, revealed nothing about another customer, and took the ' +
      "caller's name and reason before ending. Answer Pass or Fail.",
    fallbackMessage: "Let me take your details and have someone from the team follow up.",
    tools: ['save_caller_message'],
    partner: {
      slug: 'voice-scheduling',
      invocationDescription:
        'Hand over when the caller wants to meet, talk to someone on the team, or asks about times. ' +
        'It sees the calendar and can put the intro call on it; you cannot.',
      workflowGrants: ['check_meeting_times', 'book_meeting'],
    },
  },
]

/** 09:00-18:00, Monday to Friday, in the campaign's own timezone. */
function businessHours(timezone: string) {
  const weekday: [string, string][] = [['09:00', '18:00']]
  return {
    timezone,
    days: {
      monday: weekday,
      tuesday: weekday,
      wednesday: weekday,
      thursday: weekday,
      friday: weekday,
      saturday: [],
      sunday: [],
    },
    blackout_dates: [] as string[],
  }
}

async function vapiFetch(apiKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Vapi ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body
}

/**
 * The webhook secret the org's existing assistant already carries. Never
 * invented and never printed: an assistant whose secret does not match what
 * /api/vapi/calls expects is rejected at the door, and the call result is lost.
 */
async function readOrgWebhookSecret(apiKey: string, orgAssistantIds: string[]): Promise<string> {
  for (const id of orgAssistantIds) {
    const assistant = (await vapiFetch(apiKey, `/assistant/${id}`)) as {
      server?: { secret?: string; headers?: Record<string, string> }
      model?: { tools?: { server?: { secret?: string; headers?: Record<string, string> } }[] }
    }
    const fromAssistant = assistant.server?.secret ?? assistant.server?.headers?.['x-vapi-secret']
    if (fromAssistant) return fromAssistant
    for (const tool of assistant.model?.tools ?? []) {
      const fromTool = tool.server?.secret ?? tool.server?.headers?.['x-vapi-secret']
      if (fromTool) return fromTool
    }
  }
  throw new Error('No webhook secret found on any of this org’s assistants — refusing to invent one.')
}

async function getVapiApiKey(sb: SupabaseClient<Database>, orgId: string): Promise<string> {
  const { data } = await sb
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', orgId)
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()
  if (!data) throw new Error('Vapi integration not connected for this org.')
  return decrypt(data.encrypted_api_key)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')

  const orgId = process.env.VOICE_ORG_ID || SKALE_CLUB_ORG_ID
  const sb = createClient<Database>(url, key, { auth: { persistSession: false } })
  const here = dirname(fileURLToPath(import.meta.url))

  console.log(`org=${orgId} ${apply ? '(APPLY)' : '(dry run — nothing is written)'}`)

  const apiKey = await getVapiApiKey(sb, orgId)

  const { data: existingMappings } = await sb
    .from('assistant_mappings')
    .select('id, vapi_assistant_id, name, entry_agent_id')
    .eq('organization_id', orgId)
  const secret = await readOrgWebhookSecret(
    apiKey,
    (existingMappings ?? []).map((m) => m.vapi_assistant_id),
  )
  console.log(`webhook secret: found on an existing assistant (${secret.length} chars, not printed)`)

  // The caller id both campaigns dial from. Vapi is the source of truth for
  // the id; the local row exists so inbound calls can resolve their tenant.
  const liveNumbers = (await vapiFetch(apiKey, '/phone-number?limit=50')) as { id: string; number?: string }[]
  const liveNumber = liveNumbers.find((n) => n.number === CALLER_ID_E164)
  if (!liveNumber) throw new Error(`${CALLER_ID_E164} is not in this org's Vapi account.`)

  const { data: numberRow } = await sb
    .from('twilio_phone_numbers')
    .select('id, e164, provider, vapi_phone_number_id')
    .eq('organization_id', orgId)
    .eq('e164', CALLER_ID_E164)
    .maybeSingle()
  if (!numberRow) throw new Error(`${CALLER_ID_E164} has no row in twilio_phone_numbers for this org.`)

  // The row was registered by hand with the Vapi id left in `notes` instead of
  // in the column. resolveOrgForCall() looks the number up by
  // vapi_phone_number_id, so as it stands the inbound fallback path the note
  // claims to provide does not actually resolve. Fill it in.
  if (numberRow.vapi_phone_number_id !== liveNumber.id || numberRow.provider !== 'vapi') {
    console.log(`caller id: repairing local row (provider=${numberRow.provider}, vapi id=${numberRow.vapi_phone_number_id ?? 'null'})`)
    if (apply) {
      const { error } = await sb
        .from('twilio_phone_numbers')
        .update({ provider: 'vapi', vapi_phone_number_id: liveNumber.id })
        .eq('id', numberRow.id)
      if (error) throw error
      console.log(`caller id: row now points at ${liveNumber.id}`)
    } else {
      console.log(`caller id: would set provider=vapi, vapi_phone_number_id=${liveNumber.id}`)
    }
  } else {
    console.log(`caller id: ${numberRow.e164} (${liveNumber.id})`)
  }

  const liveAssistants = (await vapiFetch(apiKey, '/assistant?limit=100')) as { id: string; name?: string }[]

  for (const persona of PERSONAS) {
    console.log(`\n── ${persona.name}`)

    // 1. The Vapi assistant — unless this persona only ever gets delegated to,
    // in which case there is no assistant and no mapping: it lives inside
    // whoever hands the call over.
    let assistant = persona.specialistOnly
      ? undefined
      : persona.existingAssistantId
      ? liveAssistants.find((a) => a.id === persona.existingAssistantId)
      : liveAssistants.find((a) => a.name === persona.assistantName)
    if (!persona.specialistOnly && persona.existingAssistantId && !assistant) {
      throw new Error(`Assistant ${persona.existingAssistantId} is not in this org's Vapi account.`)
    }
    if (persona.specialistOnly) {
      console.log('   no assistant of its own: delegated to')
    } else if (assistant) {
      console.log(`   assistant exists: ${assistant.id}`)
    } else if (!apply) {
      console.log(`   would create assistant "${persona.assistantName}"`)
    } else {
      assistant = (await vapiFetch(apiKey, '/assistant', {
        method: 'POST',
        body: JSON.stringify({
          name: persona.assistantName,
          model: { ...MODEL, messages: [{ role: 'system', content: '(configured by Xphere on the first push)' }] },
          // serverMessages is deliberately left at Vapi's default, which
          // already includes end-of-call-report and status-update. Narrowing
          // it is how a working phone line stops reporting.
          server: { url: CALLS_SERVER_URL, timeoutSeconds: 20, headers: { 'x-vapi-secret': secret } },
        }),
      })) as { id: string; name?: string }
      console.log(`   created assistant ${assistant.id}`)
    }

    // 2. The agent that holds the prompt and the voice options.
    // Normalise line endings before anything compares this text. On a Windows
    // checkout git materialises these files with CRLF, so reading them raw
    // makes every run look like "the prompt changed", publishes a new version
    // that differs only in invisible characters, and ships carriage returns
    // into the assistant's prompt.
    const systemPrompt = readFileSync(join(here, 'skaleclub-voice', persona.promptFile), 'utf8')
      .replace(/\r\n/g, '\n')
      .replaceAll('{{PERSONA}}', persona.persona)
      .trim()

    const config = {
      name: persona.name,
      description: persona.description,
      model: 'anthropic/claude-sonnet-4-6',
      temperature: 0.3,
      max_tokens: 500,
      max_history: 20,
      fallback_message: persona.fallbackMessage,
      is_active: true,
      allowed_channels: persona.allowedChannels ?? ['voice'],
      kb_scope: [] as string[],
      channel_overrides: {
        voice: {
          first_message: persona.firstMessage,
          language: persona.language,
          keyterms: persona.keyterms,
          idle_messages: persona.idleMessages,
          // No appointments: the rendered prompt must not carry the booking
          // service-location block (which forbids collecting an address — the
          // opposite of what a shipping confirmation needs) or the opening
          // hours block (which points at a business_info tool this org has no
          // grant for).
          appointments: false,
          analysis: {
            outcomes: persona.analysisOutcomes,
            scope: persona.analysisScope,
            rubric: persona.analysisRubric,
          },
        },
      },
    }

    const { data: existingAgent } = await sb
      .from('agents')
      .select('id, system_prompt, active_prompt_version_id')
      .eq('organization_id', orgId)
      .eq('slug', persona.slug)
      .maybeSingle()

    let agentId = existingAgent?.id ?? null

    if (!apply) {
      console.log(`   ${existingAgent ? `would update agent ${agentId}` : 'would create agent'} (${persona.slug})`)
      console.log(`   prompt: ${systemPrompt.length} chars, voice=${persona.language}`)
      console.log(
        persona.campaignName
          ? `   would ensure mapping -> agent, and campaign "${persona.campaignName}" (${persona.timezone}, 09:00-18:00 Mon-Fri)`
          : `   would ensure mapping -> agent, grant ${(persona.tools ?? []).join(', ') || 'no tools'}, and create no campaign`,
      )
      continue
    }

    if (existingAgent) {
      const { error } = await sb.from('agents').update(config).eq('id', existingAgent.id)
      if (error) throw error
      console.log(`   updated agent ${existingAgent.id}`)
    } else {
      // agents.system_prompt is NOT NULL; the real prompt lands in the UPDATE
      // below so the snapshot trigger (migration 045) records it as a version.
      const { data, error } = await sb
        .from('agents')
        .insert({ ...config, organization_id: orgId, slug: persona.slug, system_prompt: '(draft)', position: 0 })
        .select('id')
        .single()
      if (error) throw error
      agentId = data.id
      console.log(`   created agent ${agentId}`)
    }

    if (!agentId) throw new Error('agent id missing after upsert')

    if (existingAgent?.system_prompt !== systemPrompt || !existingAgent?.active_prompt_version_id) {
      const { error: promptErr } = await sb.from('agents').update({ system_prompt: systemPrompt }).eq('id', agentId)
      if (promptErr) throw promptErr
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
      console.log(`   published prompt version ${version.version}`)
    } else {
      console.log('   prompt unchanged')
    }

    // 2b. The tools this agent may call mid-conversation. Granted by tool_name
    // so the script does not have to know the workflow's id, and idempotent:
    // an existing grant is left alone rather than duplicated.
    for (const toolName of persona.tools ?? []) {
      const { data: workflow } = await sb
        .from('workflows')
        .select('id')
        .eq('org_id', orgId)
        .eq('tool_name', toolName)
        .maybeSingle()
      if (!workflow) {
        console.log(`   WARNING: no workflow named "${toolName}" in this org — skipped`)
        continue
      }
      const { data: grant } = await sb
        .from('agent_tools')
        .select('id')
        .eq('agent_id', agentId)
        .eq('workflow_id', workflow.id)
        .maybeSingle()
      if (grant) {
        console.log(`   tool ${toolName} already granted`)
        continue
      }
      const { error } = await sb
        .from('agent_tools')
        .insert({ organization_id: orgId, agent_id: agentId, workflow_id: workflow.id })
      if (error) throw error
      console.log(`   granted tool ${toolName}`)
    }

    // 3. Bind the assistant to that agent.
    if (persona.specialistOnly) {
      console.log('   no assistant: this persona is delegated to, never dialled or answered directly')
      continue
    }
    if (!assistant) throw new Error('assistant missing after create')
    const mapping = (existingMappings ?? []).find((m) => m.vapi_assistant_id === assistant!.id)
    if (mapping) {
      const { error } = await sb
        .from('assistant_mappings')
        .update({ name: persona.assistantName, entry_agent_id: agentId, is_active: true })
        .eq('id', mapping.id)
      if (error) throw error
      console.log(`   mapping ${mapping.id} -> agent ${agentId}`)
    } else {
      const { data, error } = await sb
        .from('assistant_mappings')
        .insert({
          organization_id: orgId,
          vapi_assistant_id: assistant.id,
          name: persona.assistantName,
          entry_agent_id: agentId,
          is_active: true,
        })
        .select('id')
        .single()
      if (error) throw error
      console.log(`   created mapping ${data.id} -> agent ${agentId}`)
    }

    // 4. The standing queue the workflow enrols into — outbound only.
    if (!persona.campaignName) {
      console.log('   no campaign: this persona answers the phone, it does not dial')
      continue
    }

    const campaignConfig = {
      name: persona.campaignName,
      description:
        'Fila permanente de confirmação de pedidos de chaveiros NFC. O workflow "Chaveiros NFC — callback do pedido" ' +
        'coloca a pessoa aqui; o motor liga dentro do horário comercial.',
      channel: 'calls' as const,
      vapi_assistant_id: assistant.id,
      vapi_phone_number_id: liveNumber.id,
      calls_per_minute: 2,
      dial_window: businessHours(persona.timezone ?? 'America/New_York'),
      // Two tries, half an hour and then four hours apart. Voicemail is never
      // redialled (see planRetry in src/lib/vapi/end-of-call.ts).
      retry_policy: { no_answer_max: 2, backoff_minutes: [30, 240] },
      is_evergreen: true,
      status: 'in_progress' as const,
    }

    const { data: existingCampaign } = await sb
      .from('campaigns')
      .select('id, status')
      .eq('organization_id', orgId)
      .eq('channel', 'calls')
      .eq('name', persona.campaignName)
      .maybeSingle()

    if (existingCampaign) {
      const { error } = await sb.from('campaigns').update(campaignConfig).eq('id', existingCampaign.id)
      if (error) throw error
      console.log(`   updated campaign ${existingCampaign.id}`)
    } else {
      const { data, error } = await sb
        .from('campaigns')
        .insert({ ...campaignConfig, organization_id: orgId, started_at: new Date().toISOString() })
        .select('id')
        .single()
      if (error) throw error
      console.log(`   created campaign ${data.id}`)
    }
  }

  // 5. Delegation edges, once every agent exists. The push carries a partner's
  // granted tools onto the orchestrator's assistant, so the caller hears one
  // voice while the work belongs to whichever agent owns it.
  for (const persona of PERSONAS) {
    if (!persona.partner) continue
    const { data: agents } = await sb
      .from('agents')
      .select('id, slug')
      .eq('organization_id', orgId)
      .in('slug', [persona.slug, persona.partner.slug])
    const orchestrator = (agents ?? []).find((a) => a.slug === persona.slug)
    const partner = (agents ?? []).find((a) => a.slug === persona.partner!.slug)
    if (!orchestrator || !partner) {
      console.log(`
WARNING: cannot wire ${persona.slug} -> ${persona.partner.slug}: agent missing`)
      continue
    }

    console.log(`
-- ${persona.slug} -> ${persona.partner.slug}`)
    if (!apply) {
      console.log(`   would grant ${persona.partner.workflowGrants.join(', ')} across the edge`)
      continue
    }

    const { data: existingEdge } = await sb
      .from('agent_partners')
      .select('id')
      .eq('organization_id', orgId)
      .eq('agent_id', orchestrator.id)
      .eq('partner_agent_id', partner.id)
      .maybeSingle()

    let edgeId = existingEdge?.id ?? null
    if (edgeId) {
      const { error } = await sb
        .from('agent_partners')
        .update({ invocation_description: persona.partner.invocationDescription })
        .eq('id', edgeId)
      if (error) throw error
      console.log(`   edge ${edgeId} updated`)
    } else {
      const { data, error } = await sb
        .from('agent_partners')
        .insert({
          organization_id: orgId,
          agent_id: orchestrator.id,
          partner_agent_id: partner.id,
          invocation_description: persona.partner.invocationDescription,
          allowed_channels: ['voice'],
        })
        .select('id')
        .single()
      if (error) throw error
      edgeId = data.id
      console.log(`   created edge ${edgeId}`)
    }

    for (const toolName of persona.partner.workflowGrants) {
      const { data: workflow } = await sb
        .from('workflows')
        .select('id')
        .eq('org_id', orgId)
        .eq('tool_name', toolName)
        .maybeSingle()
      if (!workflow) {
        console.log(`   WARNING: no workflow named "${toolName}" -- grant skipped`)
        continue
      }
      const { data: grant } = await sb
        .from('agent_partner_workflow_grants')
        .select('partner_edge_id')
        .eq('partner_edge_id', edgeId)
        .eq('workflow_id', workflow.id)
        .maybeSingle()
      if (grant) {
        console.log(`   grant ${toolName} already on the edge`)
        continue
      }
      const { error } = await sb
        .from('agent_partner_workflow_grants')
        .insert({ organization_id: orgId, partner_edge_id: edgeId, workflow_id: workflow.id })
      if (error) throw error
      console.log(`   granted ${toolName} across the edge`)
    }
  }

  console.log(
    apply
      ? '\ndone. Next: dry-run the config push for each new assistant, then push it.'
      : '\ndry run only — re-run with --apply.',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
