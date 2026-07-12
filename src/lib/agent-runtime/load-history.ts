// src/lib/agent-runtime/load-history.ts
//
// Shared conversation-memory loader for the messaging-channel webhook handlers
// (WhatsApp/Evolution, Twilio SMS, Telegram, Meta, Zernio). Those handlers call
// runAgent() with only `userMessage` + `conversationId`, so every turn is
// stateless for the LLM — the agent never sees what was said earlier. The web
// widget path already threads history via `historyWindow`; this helper lets the
// messaging handlers do the same by reconstructing that window from the
// persisted `conversation_messages` rows.
//
// runAgent() builds its LLM message array as:
//   [...historyWindow.slice(-maxHistory), { role: 'user', content: userMessage }]
// so `historyWindow` MUST NOT include the current inbound message — runAgent
// appends `userMessage` itself. The handlers insert the inbound row (via
// normalizeInbound or a direct insert) BEFORE calling runAgent, so the newest
// stored row is that same message; we drop it from the tail here.
//
// Role mapping mirrors the web widget history (src/lib/chat/persist.ts +
// session.ts), which only ever persists/replays 'user' and 'assistant'. Other
// roles present in conversation_messages ('system' from tool side-effects,
// 'agent' from human-operator MCP replies) are NOT part of that contract, so we
// keep only 'user' and 'assistant' and skip everything else.
//
// History is best-effort: any query error yields [] so the reply path never
// breaks — matching how runAgent treats KB lookup failures as non-fatal.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type HistoryTurn = { role: 'user' | 'assistant'; content: string }

export async function loadHistoryWindow(params: {
  /** Service-role client the handler already holds (RLS bypassed in webhook context). */
  supabase: SupabaseClient<Database>
  conversationId: string
  /** The just-inserted inbound message; dropped from the tail so it isn't duplicated. */
  currentUserMessage: string
  /** Max prior turns to return (default 20). */
  limit?: number
}): Promise<HistoryTurn[]> {
  const { supabase, conversationId, currentUserMessage } = params
  const limit = params.limit ?? 20

  try {
    // Pull a few extra rows (limit + buffer) so that after we filter out
    // non-user/assistant roles and drop the current message we still have
    // enough turns to fill the window.
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit + 5)

    if (error || !data) return []

    // Reverse newest-first → chronological order for the LLM.
    const chronological = [...data].reverse()

    // Keep only replayable roles with non-empty content.
    const turns: HistoryTurn[] = []
    for (const row of chronological) {
      const role = (row as { role: string }).role
      const content = (row as { content: string | null }).content
      if (role !== 'user' && role !== 'assistant') continue
      if (typeof content !== 'string' || content.length === 0) continue
      turns.push({ role, content })
    }

    // Drop the just-inserted inbound message: it is the newest 'user' row and
    // must not appear here because runAgent appends `userMessage` itself. Only
    // one occurrence, only at the tail.
    const last = turns[turns.length - 1]
    if (last && last.role === 'user' && last.content === currentUserMessage) {
      turns.pop()
    }

    // Trim to the most recent `limit` turns.
    return turns.slice(-limit)
  } catch {
    return []
  }
}
