// src/lib/agent-runtime/human-takeover.ts
//
// The two ways a conversation moves from the bot to a person (migration 1302):
//
//   markHumanTakeover   — a human replied (inbox, MCP, phone app echo). The bot
//                         goes quiet for HUMAN_TAKEOVER_PAUSE_MS after the last
//                         human message, then may answer again. Any keyword
//                         engagement ends, so only a fresh keyword re-engages.
//   requestHumanHandoff — the agent asked for a human (handoff_to_human tool).
//                         The bot stays off until someone turns it back on, and
//                         the team is alerted (in-app/push + Telegram if set up).
//
// Both are best-effort and never throw: they run inside send paths and webhook
// handlers whose primary job must not fail because of them.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { HUMAN_TAKEOVER_PAUSE_MS } from './conversation-routing'
import { insertNotification } from '@/lib/notifications/insert'
import { executeSendTelegramNotification } from '@/lib/action-engine/executors/send-telegram-notification'

export async function markHumanTakeover(params: {
  supabase: SupabaseClient<Database>
  conversationId: string
  now?: Date
}): Promise<void> {
  const { supabase, conversationId } = params
  const now = params.now ?? new Date()
  try {
    const { data: conv } = await supabase
      .from('conversations')
      .select('bot_status, bot_paused_until')
      .eq('id', conversationId)
      .maybeSingle()
    if (!conv) return

    // An open-ended pause (manual toggle or handoff) is already stronger than
    // a timed one — leave it alone apart from ending any engagement.
    const indefinitelyPaused = conv.bot_status === 'paused' && !conv.bot_paused_until
    const update: Database['public']['Tables']['conversations']['Update'] = indefinitelyPaused
      ? { engaged_agent_id: null, engaged_at: null }
      : {
          bot_status: 'paused',
          bot_paused_until: new Date(now.getTime() + HUMAN_TAKEOVER_PAUSE_MS).toISOString(),
          bot_paused_reason: 'human_reply',
          engaged_agent_id: null,
          engaged_at: null,
          updated_at: now.toISOString(),
        }
    await supabase.from('conversations').update(update).eq('id', conversationId)
  } catch (err) {
    console.error('[agent-runtime/human-takeover] markHumanTakeover failed:', err)
  }
}

export async function requestHumanHandoff(params: {
  supabase: SupabaseClient<Database>
  orgId: string
  conversationId: string
  reason?: string | null
}): Promise<void> {
  const { supabase, orgId, conversationId } = params
  const reason = params.reason?.trim() || null
  const now = new Date().toISOString()

  // The pause itself uses only pre-1302 columns so it holds even on a database
  // without the migration; the bookkeeping columns follow best-effort.
  await supabase
    .from('conversations')
    .update({ bot_status: 'paused', updated_at: now })
    .eq('id', conversationId)
  await supabase
    .from('conversations')
    .update({
      bot_paused_until: null,
      bot_paused_reason: 'handoff',
      engaged_agent_id: null,
      engaged_at: null,
    })
    .eq('id', conversationId)

  // Everything below is notification only — never blocks the handoff itself.
  try {
    await supabase.from('conversation_messages').insert({
      conversation_id: conversationId,
      org_id: orgId,
      role: 'system',
      content: reason ? `🙋 Handoff to a human requested: ${reason}` : '🙋 Handoff to a human requested.',
      metadata: { type: 'handoff', reason },
    })
  } catch {
    // timeline note is non-critical
  }

  try {
    const { data: conv } = await supabase
      .from('conversations')
      .select('visitor_name, visitor_phone, channel')
      .eq('id', conversationId)
      .maybeSingle()
    const who = conv?.visitor_name || conv?.visitor_phone || 'Um contato'

    await insertNotification(orgId, 'handoff_requested', {
      conversation_id: conversationId,
      contact_name: who,
      channel: conv?.channel ?? null,
      reason,
    })

    await executeSendTelegramNotification({
      orgId,
      text: [
        `🙋 ${who} precisa de atendimento humano`,
        reason ? `Motivo: ${reason}` : null,
        `https://xphere.app/inbox?conversation=${conversationId}`,
      ]
        .filter(Boolean)
        .join('\n'),
    })
  } catch (err) {
    console.error('[agent-runtime/human-takeover] handoff alert failed:', err)
  }
}
