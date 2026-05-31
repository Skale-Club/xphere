// src/lib/messaging/normalize-inbound.ts
//
// Shared inbound normalization: every channel webhook handler (Twilio SMS,
// Evolution/WhatsApp, Telegram, Meta, GHL, email) repeats the same DB sequence
// to land an inbound message:
//
//   1. find-or-create a `conversations` row (dedup key varies per channel)
//   2. (optional) skip if this exact provider message was already stored
//   3. insert the inbound `conversation_messages` row
//   4. bump the conversation's last_message / last_inbound_at
//
// This helper owns that sequence so handlers stop duplicating it and can't
// drift (e.g. forgetting last_inbound_at/updated_at). Callers still build the
// channel-specific payloads — the variance lives in the data, not the steps.
//
// Contact resolution and agent dispatch intentionally stay in the handlers;
// they are too channel-specific to unify here.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Db = SupabaseClient<Database>

/** How to dedup the conversation for this channel. */
export type ConversationMatch =
  // Evolution / Telegram / Twilio: org + channel + visitor_phone
  | { by: 'visitor_phone'; phone: string }
  // Meta / GHL: org + channel + one or more channel_metadata->>key matches
  | { by: 'metadata'; keys: Record<string, string> }
  // Email: org + channel + contact_id, newest open thread
  | { by: 'contact_open'; contactId: string }

export interface NormalizeInboundInput {
  /** Service-role client (handlers run in after()/webhook context). */
  supabase: Db
  orgId: string
  channel: string
  match: ConversationMatch
  /**
   * `conversations` insert payload used when creating. `org_id` + `channel` are
   * merged in. May be a factory that is awaited ONLY on the create path — use
   * this when building the payload is expensive (e.g. resolving a contact) so
   * the work is skipped when an existing conversation is matched.
   */
  createPayload: Record<string, unknown> | (() => Promise<Record<string, unknown>>)
  /** `conversations` update payload applied when an existing row is matched. */
  updatePayload: Record<string, unknown>
  /** `conversation_messages` insert payload. `org_id` + `conversation_id` are merged in. */
  message: Record<string, unknown>
  /**
   * Optional idempotency guard. After the conversation is upserted, the message
   * insert is skipped (result.duplicate = true) when a role='user' message
   * already exists whose metadata contains these keys — matching how handlers
   * dedup by provider message id (message_sid, evolution_message_id, meta_mid…).
   */
  idempotencyMetadata?: Record<string, unknown>
  /**
   * Upsert-only mode: find-or-create the conversation and return, WITHOUT the
   * idempotency check or message insert. Used by handlers whose message write
   * is bespoke (e.g. Meta downloads/re-hosts media against a pre-generated
   * message id between the upsert and the insert). `message` is ignored.
   */
  skipMessage?: boolean
}

/** Existing conversation columns returned to the caller for downstream logic. */
export interface ExistingConversation {
  id: string
  bot_status: string | null
  contact_id: string | null
  channel_metadata: unknown
  last_inbound_at: string | null
  status: string | null
}

export interface NormalizeInboundResult {
  conversationId: string
  /** True when a new conversation row was created. */
  isNew: boolean
  /** The matched existing conversation (null when newly created). */
  existing: ExistingConversation | null
  /** Inserted inbound message id; null when skipped (duplicate) or on error. */
  messageId: string | null
  /** True when the message was skipped by the idempotency guard. */
  duplicate: boolean
  /** Set when the conversation create or message insert failed. */
  error?: string
}

const EXISTING_COLS = 'id, bot_status, contact_id, channel_metadata, last_inbound_at, status'

export async function normalizeInbound(
  input: NormalizeInboundInput,
): Promise<NormalizeInboundResult> {
  const { supabase, orgId, channel, match, createPayload, updatePayload, message, idempotencyMetadata, skipMessage } = input

  // 1. Find existing conversation by the channel's dedup key.
  let q = supabase
    .from('conversations')
    .select(EXISTING_COLS)
    .eq('org_id', orgId)
    .eq('channel', channel)
  if (match.by === 'visitor_phone') {
    q = q.eq('visitor_phone', match.phone)
  } else if (match.by === 'metadata') {
    for (const [k, v] of Object.entries(match.keys)) {
      q = q.eq(`channel_metadata->>${k}`, v)
    }
  } else {
    q = q.eq('contact_id', match.contactId).eq('status', 'open').order('created_at', { ascending: false })
  }
  const { data: existing } = await q.limit(1).maybeSingle<ExistingConversation>()

  // 2. Upsert the conversation.
  let conversationId: string
  let isNew: boolean
  if (existing) {
    conversationId = existing.id
    isNew = false
    // Skip an empty update — some handlers (e.g. Telegram) don't touch the
    // conversation during the upsert and bump last_message later themselves.
    if (Object.keys(updatePayload).length > 0) {
      await supabase.from('conversations').update(updatePayload as never).eq('id', conversationId)
    }
  } else {
    const resolvedCreate = typeof createPayload === 'function' ? await createPayload() : createPayload
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ org_id: orgId, channel, ...resolvedCreate } as never)
      .select('id')
      .single()
    if (error || !created) {
      return {
        conversationId: '',
        isNew: false,
        existing: null,
        messageId: null,
        duplicate: false,
        error: error?.message ?? 'conversation_insert_failed',
      }
    }
    conversationId = (created as { id: string }).id
    isNew = true
  }

  // Upsert-only mode: caller owns the message write.
  if (skipMessage) {
    return { conversationId, isNew, existing, messageId: null, duplicate: false }
  }

  // 3. Idempotency guard — skip the insert if this provider message is known.
  // Only run when every key has a usable (truthy) value: an undefined provider
  // id would serialize to `{}` and `.contains('metadata', {})` matches ANY
  // prior user message, which would silently drop every inbound. When the id
  // is missing we prefer inserting (no dedup) over dropping.
  if (idempotencyMetadata && Object.values(idempotencyMetadata).every((v) => v != null && v !== '')) {
    const { data: dup } = await supabase
      .from('conversation_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('role', 'user')
      .contains('metadata', idempotencyMetadata as never)
      .limit(1)
      .maybeSingle()
    if (dup) {
      return { conversationId, isNew, existing, messageId: null, duplicate: true }
    }
  }

  // 4. Insert the inbound message.
  const { data: msg, error: msgErr } = await supabase
    .from('conversation_messages')
    .insert({ org_id: orgId, conversation_id: conversationId, ...message } as never)
    .select('id')
    .single()
  if (msgErr || !msg) {
    return {
      conversationId,
      isNew,
      existing,
      messageId: null,
      duplicate: false,
      error: msgErr?.message ?? 'message_insert_failed',
    }
  }

  return { conversationId, isNew, existing, messageId: (msg as { id: string }).id, duplicate: false }
}
