#!/usr/bin/env node
// Creates / updates the Skale Club "Chaveiros NFC" WhatsApp agent.
// Idempotent: re-running updates the same agent (slug 'chaveiros-nfc') in place
// and only publishes a new prompt version when the prompt text changed.
//
// Run (needs migration 1302 applied):
//   npx tsx --env-file=.env.local scripts/setup-skaleclub-nfc-agent.ts [--dry-run]
//
// Env:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required)
//   NFC_AGENT_ORG_ID    org to install into (default: Skale Club)
//   NFC_PERSONA_NAME    the name the bot introduces itself with. Default: the
//                       name of the org's current WhatsApp agent, so customers
//                       keep talking to the same "person".
//
// What it configures — all platform features, nothing Skale-Club-specific in
// the runtime (see .planning/research/nfc-keychain-whatsapp-agent.md):
//   - activation_keywords: the agent only takes a WhatsApp conversation when
//     the customer (or our campaign opener) mentions chaveiro / keychain / NFC.
//   - message_label: every reply starts with "🤖 <persona> (assistente virtual)".
//   - kb_scope = []: no knowledge-base retrieval. Everything the agent may say
//     is in its prompt, so it cannot surface unrelated internal documents.
//   - allowed_channels = ['whatsapp'].
//
// The price table inside system-prompt.md mirrors skaleclub
// shared/nfc-pricing.ts (NFC_PRICING_VERSION 2026-09-22.1). When prices change
// there, update the table and re-run this script.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { NFC_ACTIVATION_KEYWORDS } from './skaleclub-nfc-agent/keywords'

const SKALE_CLUB_ORG_ID = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'
const AGENT_SLUG = 'chaveiros-nfc'
const AGENT_NAME = 'Chaveiros NFC'
const FALLBACK_PERSONA = 'Assistente Skale Club'


// Seeded default names ("Main Agent", "Assistant") make poor personas.
function isGenericAgentName(name: string): boolean {
  return /\b(main|default|agent|agente|assistant|bot|test|teste)\b/i.test(name)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }
  const orgId = process.env.NFC_AGENT_ORG_ID || SKALE_CLUB_ORG_ID
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // ── Persona: reuse the name of the org's current WhatsApp agent ────────────
  let persona = process.env.NFC_PERSONA_NAME?.trim() || ''
  if (!persona) {
    const { data: def } = await sb
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', orgId)
      .eq('channel', 'whatsapp')
      .maybeSingle()
    if (def?.agent_id) {
      const { data: current } = await sb.from('agents').select('name').eq('id', def.agent_id).maybeSingle()
      const name = (current?.name as string | undefined)?.trim()
      if (name && !isGenericAgentName(name) && name !== AGENT_NAME) persona = name
    }
  }
  if (!persona) persona = FALLBACK_PERSONA
  console.log(`org=${orgId} persona="${persona}"`)

  const here = dirname(fileURLToPath(import.meta.url))
  const systemPrompt = readFileSync(join(here, 'skaleclub-nfc-agent', 'system-prompt.md'), 'utf8')
    .replaceAll('{{PERSONA}}', persona)
    .trim()
  const messageLabel = `🤖 ${persona} (assistente virtual)`

  const config = {
    name: AGENT_NAME,
    description:
      'Atende no WhatsApp quem fala de chaveiros NFC: tira dúvidas, passa o preço do modelo liso, ' +
      'manda o formulário de pedido e chama a equipe no resto. Só entra na conversa por palavra-chave.',
    model: 'anthropic/claude-sonnet-4-6',
    temperature: 0.3,
    max_tokens: 700,
    max_history: 30,
    fallback_message:
      'Já chamo alguém da equipe para continuar com você por aqui. / Someone from our team will follow up here shortly.',
    is_active: true,
    allowed_channels: ['whatsapp'],
    kb_scope: [] as string[],
    activation_keywords: NFC_ACTIVATION_KEYWORDS,
    message_label: messageLabel,
  }

  const { data: existing, error: findErr } = await sb
    .from('agents')
    .select('id, system_prompt, active_prompt_version_id')
    .eq('organization_id', orgId)
    .eq('slug', AGENT_SLUG)
    .maybeSingle()
  if (findErr) throw findErr

  if (dryRun) {
    console.log(existing ? `would update agent ${existing.id}` : 'would create agent')
    console.log({ ...config, system_prompt: `${systemPrompt.slice(0, 200)}…` })
    return
  }

  let agentId: string
  if (existing) {
    agentId = existing.id as string
    const { error } = await sb.from('agents').update(config).eq('id', agentId)
    if (error) throw error
    console.log(`updated agent ${agentId}`)
  } else {
    // agents.system_prompt is NOT NULL; the real prompt goes in with the UPDATE
    // below so the snapshot trigger (migration 045) records it as a version.
    const { data, error } = await sb
      .from('agents')
      .insert({ ...config, organization_id: orgId, slug: AGENT_SLUG, system_prompt: '(draft)', position: 0 })
      .select('id')
      .single()
    if (error) throw error
    agentId = data.id as string
    console.log(`created agent ${agentId}`)
  }

  const promptChanged = existing?.system_prompt !== systemPrompt
  if (promptChanged || !existing?.active_prompt_version_id) {
    if (promptChanged) {
      const { error } = await sb.from('agents').update({ system_prompt: systemPrompt }).eq('id', agentId)
      if (error) throw error
    }
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
    console.log(`published prompt version ${version.version}`)
  } else {
    console.log('prompt unchanged')
  }

  console.log(`done: keywords=${config.activation_keywords.length} label="${messageLabel}"`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
