// src/lib/agent-runtime/coalesce.ts
//
// Burst coalescing for chat replies. Customers on WhatsApp type in bursts —
// "quanto custa o chaveiro?", "uns 50", "com a minha logo" — and every message
// arrives as its own webhook. Answering each one separately produces three
// replies, the first two already out of date.
//
// Each handler waits a short quiet window BEFORE deciding anything. Only the
// handler of the newest message goes on, and it routes on the text of the
// whole burst, so a keyword in the first message still engages the agent when
// the reply is triggered by the last one. The earlier messages are already in
// its history window, because every inbound row is stored before this runs.
//
// Deciding the route first and waiting afterwards loses the burst instead: the
// second message can be routed before the first has engaged the agent (no
// route, handler gone), then the first handler stands down for the second, and
// nobody answers.
//
// Best-effort: a query failure answers alone (the old behaviour), never drops.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/** How long a burst may pause between messages and still count as one. */
export function coalesceWindowMs(): number {
  const raw = process.env.AGENT_REPLY_COALESCE_MS
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return n
  }
  // Unit tests exercise the reply path directly; they must not sleep.
  return process.env.NODE_ENV === 'test' ? 0 : 6000
}

/** Messages further apart than this are separate conversations, not one burst. */
const BURST_SPAN_MS = 2 * 60 * 1000

export interface CoalescedInbound {
  /** False when a newer message arrived: its handler answers the burst. */
  latest: boolean
  /** Text to route on: every customer message of the burst, oldest first. */
  routingText: string
}

export async function coalesceInbound(params: {
  supabase: SupabaseClient<Database>
  conversationId: string
  /** created_at of the inbound row this handler is answering. */
  sentAt: string
  /** This message's own text, used alone when the burst cannot be read. */
  text: string
  windowMs?: number
}): Promise<CoalescedInbound> {
  const { supabase, conversationId, sentAt, text } = params
  const windowMs = params.windowMs ?? coalesceWindowMs()
  const alone = { latest: true, routingText: text }
  if (windowMs <= 0) return alone
  await new Promise((resolve) => setTimeout(resolve, windowMs))

  try {
    const { data: newer, error: newerErr } = await supabase
      .from('conversation_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('role', 'user')
      .gt('created_at', sentAt)
      .limit(1)
      .maybeSingle()
    if (newerErr) return alone
    if (newer) return { latest: false, routingText: text }

    const since = new Date(Date.parse(sentAt) - BURST_SPAN_MS).toISOString()
    const { data: recent, error: recentErr } = await supabase
      .from('conversation_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .neq('role', 'system')
      .gte('created_at', since)
      .lte('created_at', sentAt)
      .order('created_at', { ascending: false })
      .limit(10)
    if (recentErr || !recent) return alone

    // Newest first: the burst is the unbroken run of customer messages that
    // ends at this one. Any reply (bot or human) closes the previous burst.
    const burst: string[] = []
    for (const row of recent as Array<{ role: string; content: string | null }>) {
      if (row.role !== 'user') break
      if (row.content) burst.unshift(row.content)
    }
    return { latest: true, routingText: burst.length > 0 ? burst.join('\n') : text }
  } catch {
    return alone
  }
}
