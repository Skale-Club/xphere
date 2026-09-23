// src/lib/agent-runtime/inbound-agent.ts
//
// Resolves which agent answers an inbound chat message, for the messaging
// webhook pipelines (WhatsApp unified, Evolution, Zernio). Supabase wiring
// around the pure rules in ./conversation-routing.ts:
//
//   1. pause gate            — isBotPaused (a lapsed human-reply pause counts as active)
//   2. live engagement       — the keyword agent already holding the conversation
//   3. keyword activation    — inbound text, or our last automated outbound text
//   4. channel default agent — today's behaviour, unless it is keyword-activated
//
// Best-effort: any failure returns null (no reply) rather than throwing into a
// webhook handler.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentChannel, Database } from '@/types/database'
import {
  ENGAGEMENT_TTL_MS,
  HUMAN_ACTIVITY_GUARD_MS,
  decideInboundAgent,
  isBotPaused,
  liveEngagedAgentId,
  matchActivationKeyword,
  type InboundAgentDecision,
} from './conversation-routing'

/** Metadata stamped on every message a human operator sends. */
export const HUMAN_SENDER_METADATA = { sender_type: 'human' } as const

/** Metadata stamped on every message an agent sends through the reply paths. */
export function agentSenderMetadata(route: Pick<InboundAgentRoute, 'agentId' | 'label'>) {
  return {
    source: 'agent',
    agent_id: route.agentId,
    ...(route.label ? { agent_label: route.label } : {}),
  }
}

export interface InboundAgentRoute {
  agentId: string
  agentName: string
  /** Customer-facing label to prepend to replies (agents.message_label). */
  label: string | null
  decision: Exclude<InboundAgentDecision, { kind: 'none' }>
}

type AgentRow = {
  id: string
  name: string
  is_active: boolean
  activation_keywords: string[] | null
  message_label: string | null
}

const AGENT_COLS = 'id, name, is_active, activation_keywords, message_label'

type ConversationState = {
  bot_status: string | null
  bot_paused_until?: string | null
  engaged_agent_id?: string | null
  engaged_at?: string | null
}

// The two loaders below fall back to the pre-1302 columns when the new ones are
// missing, so a deploy that lands before `supabase db push` keeps today's
// behaviour (bot_status gate + channel default agent) instead of going silent.

async function loadConversationState(
  supabase: SupabaseClient<Database>,
  conversationId: string,
): Promise<ConversationState | null> {
  const full = await supabase
    .from('conversations')
    .select('bot_status, bot_paused_until, engaged_agent_id, engaged_at')
    .eq('id', conversationId)
    .maybeSingle()
  if (!full.error) return full.data
  const legacy = await supabase
    .from('conversations')
    .select('bot_status')
    .eq('id', conversationId)
    .maybeSingle()
  return legacy.data
}

async function loadAgent(supabase: SupabaseClient<Database>, agentId: string): Promise<AgentRow | null> {
  const full = await supabase.from('agents').select(AGENT_COLS).eq('id', agentId).maybeSingle()
  if (!full.error) return full.data as AgentRow | null
  const legacy = await supabase.from('agents').select('id, name, is_active').eq('id', agentId).maybeSingle()
  return legacy.data ? { ...legacy.data, activation_keywords: [], message_label: null } : null
}

export async function resolveInboundAgent(params: {
  supabase: SupabaseClient<Database>
  orgId: string
  conversationId: string
  channel: AgentChannel
  text: string
  now?: Date
}): Promise<InboundAgentRoute | null> {
  const { supabase, orgId, conversationId, channel, text } = params
  const now = params.now ?? new Date()

  try {
    const conv = await loadConversationState(supabase, conversationId)
    if (isBotPaused(conv, now)) return null
    if (conv && conv.bot_status === 'paused') {
      // A human-reply pause that has lapsed: flip the row back so the inbox
      // toggle shows the bot as on again.
      await supabase
        .from('conversations')
        .update({ bot_status: 'active', bot_paused_until: null, bot_paused_reason: null })
        .eq('id', conversationId)
    }

    // Errors (e.g. migration 1302 not applied yet) degrade to "no keyword agents".
    const { data: keywordRows } = await supabase
      .from('agents')
      .select(AGENT_COLS)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .contains('allowed_channels', [channel])
    const keywordAgents = ((keywordRows ?? []) as AgentRow[]).filter(
      (a) => (a.activation_keywords?.length ?? 0) > 0,
    )

    const { data: defaultRow } = await supabase
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', orgId)
      .eq('channel', channel)
      .maybeSingle()

    let defaultAgent: AgentRow | null = null
    if (defaultRow?.agent_id) {
      defaultAgent =
        keywordAgents.find((a) => a.id === defaultRow.agent_id) ??
        (await loadAgent(supabase, defaultRow.agent_id))
    }

    // An engagement only counts while its agent is still an active keyword agent here.
    const engagedId = liveEngagedAgentId(conv, now)
    const engagedAgentId = engagedId && keywordAgents.some((a) => a.id === engagedId) ? engagedId : null

    // The two lookups below only matter when a keyword could fire.
    let humanRecentlyActive = false
    let lastAutomatedOutboundText: string | null = null
    if (!engagedAgentId && keywordAgents.length > 0) {
      const inboundHit = keywordAgents.some((a) => matchActivationKeyword(text, a.activation_keywords))
      const { data: recentHuman } = await supabase
        .from('conversation_messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .contains('metadata', HUMAN_SENDER_METADATA)
        .gte('created_at', new Date(now.getTime() - HUMAN_ACTIVITY_GUARD_MS).toISOString())
        .limit(1)
        .maybeSingle()
      humanRecentlyActive = Boolean(recentHuman)

      if (!inboundHit && !humanRecentlyActive) {
        const { data: lastOutbound } = await supabase
          .from('conversation_messages')
          .select('content, metadata, created_at')
          .eq('conversation_id', conversationId)
          .eq('role', 'assistant')
          .gte('created_at', new Date(now.getTime() - ENGAGEMENT_TTL_MS).toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const meta = (lastOutbound?.metadata ?? {}) as Record<string, unknown>
        if (lastOutbound && meta.sender_type !== 'human') {
          lastAutomatedOutboundText = lastOutbound.content ?? null
        }
      }
    }

    const decision = decideInboundAgent({
      text,
      engagedAgentId,
      keywordAgents,
      defaultAgent: defaultAgent && defaultAgent.is_active ? defaultAgent : null,
      humanRecentlyActive,
      lastAutomatedOutboundText,
    })
    if (decision.kind === 'none') return null

    const agent =
      keywordAgents.find((a) => a.id === decision.agentId) ??
      (defaultAgent?.id === decision.agentId ? defaultAgent : null)
    if (!agent) return null

    const nowIso = now.toISOString()
    if (decision.kind === 'keyword') {
      await supabase
        .from('conversations')
        .update({ engaged_agent_id: agent.id, engaged_at: nowIso })
        .eq('id', conversationId)
      await supabase.from('conversation_messages').insert({
        conversation_id: conversationId,
        org_id: orgId,
        role: 'system',
        content: `🤖 ${agent.name} assumiu a conversa (palavra-chave: "${decision.keyword}")`,
        metadata: {
          type: 'agent_engaged',
          agent_id: agent.id,
          keyword: decision.keyword,
          keyword_source: decision.source,
        },
      })
    } else if (decision.kind === 'engaged') {
      await supabase.from('conversations').update({ engaged_at: nowIso }).eq('id', conversationId)
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      label: agent.message_label?.trim() || null,
      decision,
    }
  } catch (err) {
    console.error('[agent-runtime/inbound-agent] resolve failed:', err)
    return null
  }
}
