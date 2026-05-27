// src/app/api/whatsapp/cloud/webhook/route.ts
//
// WhatsApp Cloud API (Meta Official) webhook receiver.
//
// Multi-tenant strategy:
//   - Webhook URL is global: <host>/api/whatsapp/cloud/webhook
//   - GET handshake validates META_WEBHOOK_VERIFY_TOKEN env (SaaS-wide)
//   - POST demultiplexes by entry[].changes[].value.metadata.phone_number_id
//     → whatsapp_cloud_accounts row → org_id → process
//   - Per-request HMAC validated with the per-account app_secret
//     (each customer creates their own Meta App, so the secret differs)
//
// Events handled:
//   - messages: customer inbound → reuse processWhatsAppMessage()
//   - statuses: delivery receipts → update campaign_recipients.status
//   - message_template_status_update: template APPROVED/REJECTED flips
//   - smb_message_echoes (Coexistence): outbound from the mobile Business
//     App → mirror into our inbox so the thread stays complete
//
// Always returns HTTP 200 — Meta retries on non-2xx and we never want
// bad payloads to trigger infinite retries.

import { after } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getCloudAccountByPhoneNumberId } from '@/lib/whatsapp/cloud/resolve-account'
import { processWhatsAppMessage } from '@/lib/whatsapp/process-message'
import {
  normalizeMetaMessages,
  metaCloudResolvedProvider,
} from '@/lib/whatsapp/cloud/adapters/meta'
import type {
  MetaWebhookPayload,
  MetaStatusEvent,
} from '@/lib/whatsapp/cloud/types'
import type { WhatsAppAdapter, NormalizedWhatsAppMessage, ResolvedProvider } from '@/lib/whatsapp/types'

export const runtime = 'nodejs'

// ── GET handshake ──────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const challenge = url.searchParams.get('hub.challenge')
  const token = url.searchParams.get('hub.verify_token')

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN
  if (mode === 'subscribe' && token && expected && token === expected && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return new Response('Verification failed', { status: 403 })
}

// ── POST events ────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature-256')

    let payload: MetaWebhookPayload
    try {
      payload = JSON.parse(rawBody) as MetaWebhookPayload
    } catch {
      console.warn('[meta/webhook] malformed JSON body')
      return Response.json({ ok: true })
    }

    // Defer all processing so the response returns immediately. Meta retries
    // on slow responses, so even a fast 200 is critical.
    after(async () => {
      try {
        await dispatchPayload(payload, rawBody, signature)
      } catch (err) {
        console.error('[meta/webhook] dispatch error:', err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[meta/webhook] outer error:', err)
    return Response.json({ ok: true })
  }
}

async function dispatchPayload(
  payload: MetaWebhookPayload,
  rawBody: string,
  signature: string | null,
): Promise<void> {
  if (payload.object !== 'whatsapp_business_account') return

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const field = change.field
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id

      // Most events carry phone_number_id; some app-state events do not.
      // For events without it we fall back to the entry id (WABA id).
      let account = phoneNumberId
        ? await getCloudAccountByPhoneNumberId(phoneNumberId)
        : null

      if (!account && entry.id) {
        // Best-effort lookup by WABA id (covers template-status / app-state events)
        const supabase = createServiceRoleClient()
        const { data: row } = await supabase
          .from('whatsapp_cloud_accounts')
          .select('id, org_id, app_secret_encrypted, phone_number_id')
          .eq('waba_id', entry.id)
          .eq('is_active', true)
          .maybeSingle()
        if (row) {
          account = await getCloudAccountByPhoneNumberId(row.phone_number_id)
        }
      }

      if (!account) {
        console.warn('[meta/webhook] no account for', phoneNumberId ?? entry.id, 'field=', field)
        continue
      }

      // HMAC validation — per-account app_secret. Skip if not configured.
      if (account.appSecret) {
        const ok = verifySignature(rawBody, signature, account.appSecret)
        if (!ok) {
          console.warn('[meta/webhook] invalid signature for org', account.orgId)
          continue
        }
      }

      switch (field) {
        case 'messages':
          await handleMessages(value, account)
          break
        case 'message_template_status_update':
          await handleTemplateStatus(value as unknown as TemplateStatusValue, account.orgId)
          break
        case 'smb_message_echoes':
          await handleEchoes(value, account)
          break
        case 'smb_app_state_sync':
          // v1: log and skip; future: import contacts from Business App
          break
        default:
          // Statuses arrive under field='messages' too in some payload variants
          if ((value as { statuses?: unknown[] }).statuses) {
            await handleStatuses(value, account.orgId)
          }
      }
    }
  }
}

// ── messages (inbound) ─────────────────────────────────────────────────────

async function handleMessages(
  value: MetaWebhookPayload['entry'][number]['changes'][number]['value'],
  account: { orgId: string; phoneNumberId: string; phoneNumberE164: string | null; displayName: string; id: string },
): Promise<void> {
  // Statuses can ride along inside the same value as inbound messages
  if (value.statuses && value.statuses.length > 0) {
    await handleStatuses(value, account.orgId)
  }
  if (!value.messages || value.messages.length === 0) return

  const normalized = normalizeMetaMessages(value.messages, {
    orgId: account.orgId,
    providerId: account.id,
    phoneNumberId: account.phoneNumberId,
  })

  const provider: ResolvedProvider = metaCloudResolvedProvider({
    orgId: account.orgId,
    providerId: account.id,
    phoneNumberId: account.phoneNumberId,
    phoneNumberE164: account.phoneNumberE164,
    displayName: account.displayName,
  })

  for (const msg of normalized) {
    await processWhatsAppMessage(msg, provider, NOOP_ADAPTER)
  }
}

// ── statuses (delivery) ────────────────────────────────────────────────────

async function handleStatuses(
  value: { statuses?: MetaStatusEvent[] },
  orgId: string,
): Promise<void> {
  if (!value.statuses) return
  const supabase = createServiceRoleClient()
  for (const ev of value.statuses) {
    const status = mapStatus(ev.status)
    if (!status) continue
    const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (status === 'sent' || status === 'delivered' || status === 'read') {
      update.sent_at = new Date(Number(ev.timestamp) * 1000).toISOString()
    }
    if (status === 'failed' && ev.errors?.[0]) {
      update.error_message = ev.errors[0].title ?? ev.errors[0].message ?? null
    }
    try {
      await supabase
        .from('campaign_recipients')
        .update(update)
        .eq('wamid', ev.id)
    } catch (err) {
      console.error('[meta/webhook] status update error:', err)
    }
    void orgId // currently unused; kept for future per-org audit logging
  }
}

function mapStatus(s: MetaStatusEvent['status']): 'sent' | 'delivered' | 'read' | 'failed' | null {
  switch (s) {
    case 'sent':
      return 'sent'
    case 'delivered':
      return 'delivered'
    case 'read':
      return 'read'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

// ── message_template_status_update ─────────────────────────────────────────

interface TemplateStatusValue {
  event?: string
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  new_status?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED'
  reason?: string
}

async function handleTemplateStatus(value: TemplateStatusValue, orgId: string): Promise<void> {
  if (!value.message_template_id || !value.new_status) return
  const supabase = createServiceRoleClient()
  try {
    await supabase
      .from('whatsapp_templates')
      .update({ status: value.new_status })
      .eq('org_id', orgId)
      .eq('meta_template_id', String(value.message_template_id))
  } catch (err) {
    console.error('[meta/webhook] template status update error:', err)
  }
}

// ── smb_message_echoes (Coexistence) ───────────────────────────────────────
// Echoes are messages the team sent FROM the mobile WhatsApp Business app
// to a customer. We persist them as outbound conversation messages so the
// shared inbox history stays complete. processWhatsAppMessage short-circuits
// on isFromMe, so we write directly.

async function handleEchoes(
  value: MetaWebhookPayload['entry'][number]['changes'][number]['value'],
  account: { orgId: string; phoneNumberId: string },
): Promise<void> {
  if (!value.messages || value.messages.length === 0) return
  const supabase = createServiceRoleClient()
  for (const msg of value.messages) {
    // Echo `from` is OUR business number; the recipient is in msg.context
    // or a `to` field depending on the variant. The simplest dedup key is
    // the wamid (msg.id) — Meta dedups against this on its end too.
    const text = msg.text?.body ?? msg.image?.caption ?? msg.video?.caption ?? msg.document?.caption ?? ''
    if (!text) continue

    // Best-effort match a recent conversation by phone_number_id metadata.
    // If we can't locate it we skip silently (no history to attach to).
    const { data: convo } = await supabase
      .from('conversations')
      .select('id')
      .eq('org_id', account.orgId)
      .contains('channel_metadata', { phone_number_id: account.phoneNumberId })
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!convo) continue

    // Idempotency: skip if we already persisted this wamid
    const { data: dup } = await supabase
      .from('conversation_messages')
      .select('id')
      .eq('conversation_id', convo.id)
      .contains('metadata', { wamid: msg.id })
      .limit(1)
      .maybeSingle()
    if (dup) continue

    try {
      await supabase.from('conversation_messages').insert({
        conversation_id: convo.id,
        org_id: account.orgId,
        role: 'assistant',
        content: text,
        metadata: {
          channel: 'whatsapp',
          provider: 'meta_cloud',
          source: 'mobile_app_echo',
          wamid: msg.id,
        },
      })
    } catch (err) {
      console.error('[meta/webhook] echo persist error:', err)
    }
  }
}

// ── HMAC ──────────────────────────────────────────────────────────────────

function verifySignature(
  rawBody: string,
  signature: string | null,
  appSecret: string,
): boolean {
  if (!signature) return false
  const stripped = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(stripped, 'hex'))
  } catch {
    return false
  }
}

// ── No-op media adapter ───────────────────────────────────────────────────
// The Meta inbound payload references media by media_id; fetching needs a
// separate Graph API call we'll add in a follow-up. For now leave media as
// an empty array — text-only messages still work end-to-end.
const NOOP_ADAPTER: WhatsAppAdapter = {
  normalize(): NormalizedWhatsAppMessage[] {
    return []
  },
  async fetchMedia() {
    return []
  },
}
