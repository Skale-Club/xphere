// src/app/api/stripe/webhook/route.ts
// Stripe webhook receiver. This is the ONLY trusted source for subscription
// state changes — the checkout success redirect is never treated as proof of
// payment.
//
// Response contract (differs from fire-and-forget webhooks like Vapi/Meta that
// always return 200, per Stripe's documented expectations):
//   - invalid / missing signature      -> 400  (reject; not a real Stripe call)
//   - duplicate event already handled   -> 200  (idempotent no-op)
//   - handled successfully              -> 200
//   - transient processing failure      -> 500  (let Stripe retry; safe because
//                                                 all state writes are idempotent)
export const runtime = 'nodejs'

import type Stripe from 'stripe'
import { getStripe } from '@/lib/billing/stripe'
import { syncSubscription } from '@/lib/billing/sync'
import { createServiceRoleClient } from '@/lib/supabase/admin'

// Only these events change internal state. Everything else is ignored safely.
const SUPPORTED_EVENTS = new Set<string>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured')
    return new Response('Webhook not configured', { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  // Raw body is required for signature verification — do not parse first.
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.warn('[stripe/webhook] Signature verification failed:', (err as Error).message)
    return new Response('Invalid signature', { status: 400 })
  }

  const supabase = createServiceRoleClient()

  // Phase 1 — idempotency guard. Record the event id before processing.
  // ignoreDuplicates so a redelivery does not error; we then check whether a
  // prior attempt already finished (processed_at set).
  await supabase
    .from('billing_events')
    .upsert(
      { stripe_event_id: event.id, type: event.type },
      { onConflict: 'stripe_event_id', ignoreDuplicates: true },
    )

  const { data: record } = await supabase
    .from('billing_events')
    .select('processed_at')
    .eq('stripe_event_id', event.id)
    .maybeSingle()

  if (record?.processed_at) {
    // Already fully handled by an earlier delivery — safe no-op.
    return Response.json({ received: true, duplicate: true })
  }

  // Phase 2 — process. Unsupported events fall through to the no-op tail.
  try {
    if (SUPPORTED_EVENTS.has(event.type)) {
      await handleEvent(event)
    }

    await supabase
      .from('billing_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id)

    return Response.json({ received: true })
  } catch (err) {
    // Leave processed_at null so Stripe's retry re-runs the (idempotent) handler.
    console.error(`[stripe/webhook] Failed handling ${event.type} (${event.id}):`, err)
    return new Response('Processing error', { status: 500 })
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripe()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      // Only subscription checkouts carry a subscription to sync.
      if (session.mode === 'subscription' && session.subscription) {
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id
        const subscription = await stripe.subscriptions.retrieve(subId)
        await syncSubscription(subscription)
      }
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // The deleted event still carries the final subscription object (status
      // 'canceled'), so the same sync path records the terminal state.
      await syncSubscription(event.data.object as Stripe.Subscription)
      break
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      // Refresh subscription state from the invoice's subscription so status
      // (active / past_due) stays accurate after each billing cycle attempt.
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoiceSubscriptionId(invoice)
      if (subId) {
        const subscription = await stripe.subscriptions.retrieve(subId)
        await syncSubscription(subscription)
      }
      break
    }
  }
}

/** Extract the subscription id from an invoice across API-version shapes. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // Newer API versions expose the link under invoice.parent.subscription_details.
  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } } }
  }).parent
  const fromParent = parent?.subscription_details?.subscription
  if (fromParent) return typeof fromParent === 'string' ? fromParent : fromParent.id

  // Fallback to the legacy top-level field when present.
  const legacy = (invoice as unknown as { subscription?: string | { id: string } }).subscription
  if (legacy) return typeof legacy === 'string' ? legacy : legacy.id

  return null
}
