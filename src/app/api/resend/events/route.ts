// src/app/api/resend/events/route.ts
// Receives Resend delivery event webhooks (delivered, bounced, complained, failed).
// Updates email_delivery_status on the matching conversation_messages row.
// Always returns HTTP 200.

export const runtime = 'nodejs'

import crypto from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { captureApiError } from '@/lib/api-error'

function validateSignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return true
    console.warn('[resend/events] RESEND_WEBHOOK_SECRET not set in production')
    return false
  }

  const svixId = headers.get('svix-id')
  const svixTimestamp = headers.get('svix-timestamp')
  const svixSignature = headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) return false

  const tsSeconds = parseInt(svixTimestamp, 10)
  if (isNaN(tsSeconds)) return false
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - tsSeconds) > 300) return false

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64')

  const signatures = svixSignature.split(' ')
  return signatures.some((s) => {
    const [, sig] = s.split(',')
    return sig === expectedSig
  })
}

// Map Resend event types to our delivery status values
const EVENT_TO_STATUS: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.delivery_delayed': 'failed',
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()

    if (!validateSignature(rawBody, request.headers)) {
      console.warn('[resend/events] Invalid webhook signature')
      return Response.json({ ok: true })
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>
    const eventType = String(payload.type ?? '')
    const newStatus = EVENT_TO_STATUS[eventType]

    if (!newStatus) {
      // Not a delivery event we track (e.g. email.opened, email.clicked)
      return Response.json({ ok: true })
    }

    const data = (payload.data ?? {}) as Record<string, unknown>
    const emailId = String(data.email_id ?? data.id ?? '')

    if (!emailId) {
      console.warn('[resend/events] No email_id in event payload')
      return Response.json({ ok: true })
    }

    const supabase = createServiceRoleClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const { error } = await db
      .from('conversation_messages')
      .update({ email_delivery_status: newStatus })
      .eq('email_message_id', emailId)

    if (error) {
      console.error('[resend/events] Failed to update delivery status:', error.message)
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[resend/events] Error processing event:', err)
    captureApiError(err)
    return Response.json({ ok: true })
  }
}
