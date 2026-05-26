// src/app/api/resend/inbound/route.ts
// Receives inbound email events from Resend via webhook.
// Validates signature → routes to org → finds/creates contact → finds/creates conversation → saves message.
// Always returns HTTP 200 per webhook reliability convention.

export const runtime = 'nodejs'

import crypto from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'

// Resend uses Svix for webhook delivery. We validate via the shared secret approach
// using RESEND_WEBHOOK_SECRET (set in environment for inbound routes).
function validateSignature(
  rawBody: string,
  headers: Headers
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // If no secret configured, allow through in development
    if (process.env.NODE_ENV !== 'production') return true
    console.warn('[resend/inbound] RESEND_WEBHOOK_SECRET not set in production')
    return false
  }

  // Svix signature validation
  const svixId = headers.get('svix-id')
  const svixTimestamp = headers.get('svix-timestamp')
  const svixSignature = headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) return false

  // Validate timestamp to prevent replay attacks (5 minute window)
  const tsSeconds = parseInt(svixTimestamp, 10)
  if (isNaN(tsSeconds)) return false
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - tsSeconds) > 300) return false

  // Compute HMAC-SHA256
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64')

  // svix-signature header may contain multiple signatures like "v1,<sig>"
  const signatures = svixSignature.split(' ')
  return signatures.some((s) => {
    const [, sig] = s.split(',')
    return sig === expectedSig
  })
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()

    if (!validateSignature(rawBody, request.headers)) {
      console.warn('[resend/inbound] Invalid webhook signature')
      // Still return 200 to avoid Resend retrying indefinitely for bad-sig events
      return Response.json({ ok: true })
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>

    // Resend inbound email payload shape
    const emailData = (payload.data ?? payload) as Record<string, unknown>
    const from = String(emailData.from ?? '')
    const toRaw = emailData.to
    const to = Array.isArray(toRaw) ? String(toRaw[0] ?? '') : String(toRaw ?? '')
    const subject = String(emailData.subject ?? '(no subject)')
    const html = String(emailData.html ?? emailData.text ?? '')
    const messageId = String(emailData.email_id ?? emailData.id ?? crypto.randomUUID())

    if (!from || !to) {
      console.warn('[resend/inbound] Missing from/to in payload')
      return Response.json({ ok: true })
    }

    const supabase = createServiceRoleClient()

    // 1. Find org from inbound_email_routes by `to` address
    const toNormalized = to.toLowerCase().trim()
    const { data: route } = await supabase
      .from('inbound_email_routes')
      .select('org_id')
      .eq('route_address', toNormalized)
      .eq('is_active', true)
      .single()

    if (!route) {
      // No route registered for this address — ignore silently
      return Response.json({ ok: true })
    }

    const orgId = route.org_id

    // 2. Find or create contact by `from` email
    const fromEmail = from.replace(/^.*<(.+)>$/, '$1').toLowerCase().trim()
    let contactId: string | null = null

    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('email_normalized', fromEmail)
      .single()

    if (existingContact) {
      contactId = existingContact.id
    } else {
      // Create a minimal contact from the from address
      const fromName = from.includes('<') ? from.replace(/<.*>/, '').trim() : fromEmail
      const { data: newContact } = await supabase
        .from('contacts')
        .insert({
          org_id: orgId,
          email: from,
          email_normalized: fromEmail,
          name: fromName || null,
          source: 'manual' as const,
        })
        .select('id')
        .single()

      contactId = newContact?.id ?? null
    }

    // 3. Find or create conversation thread (channel='email', contact_id)
    let conversationId: string

    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('org_id', orgId)
      .eq('channel', 'email')
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (existingConversation) {
      conversationId = existingConversation.id
    } else {
      // Create a new email conversation
      const { data: newConversation } = await supabase
        .from('conversations')
        .insert({
          org_id: orgId,
          widget_token: crypto.randomUUID(), // required field
          channel: 'email',
          contact_id: contactId,
          visitor_email: fromEmail,
          status: 'open',
          last_active_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          last_message: subject,
          channel_metadata: { inbound_address: toNormalized },
        })
        .select('id')
        .single()

      if (!newConversation) {
        console.error('[resend/inbound] Failed to create conversation for org', orgId)
        return Response.json({ ok: true })
      }

      conversationId = newConversation.id
    }

    // 4. Insert conversation message with email fields
    await supabase.from('conversation_messages').insert({
      org_id: orgId,
      conversation_id: conversationId,
      role: 'user',
      content: html,
      channel: 'email',
      message_type: 'email',
      email_subject: subject,
      email_from: from,
      email_to: to,
      email_message_id: messageId,
      email_delivery_status: 'delivered',
    })

    // 5. Update conversation last_message
    await supabase
      .from('conversations')
      .update({
        last_message: subject,
        last_message_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[resend/inbound] Error processing webhook:', err)
    return Response.json({ ok: true })
  }
}
