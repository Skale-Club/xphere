'use server'

// Billing server actions. These are the ONLY way the app creates Stripe Checkout
// and Customer Portal sessions — everything is server-side. The client passes an
// opaque plan key at most; price, customer, mode, URLs, and metadata are all set
// here from trusted server state.
import { getStripe } from './stripe'
import { resolvePriceId } from './plans'
import { topupPriceId } from './catalog'
import { getOrCreateStripeCustomer } from './customers'
import { getBillingContext, getBaseUrl } from './context'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Create a Stripe Hosted Checkout session (subscription mode) for the caller's
 * org and return the redirect URL. The success redirect is NOT proof of payment
 * — entitlement is granted only when the webhook confirms the subscription.
 */
export async function createCheckoutSession(
  planKey: string,
): Promise<ActionResult<{ url: string }>> {
  const ctx = await getBillingContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!ctx.isAdmin) return { ok: false, error: 'Only org admins can manage billing.' }

  const priceId = resolvePriceId(planKey)
  if (!priceId) return { ok: false, error: 'Unknown or unconfigured plan.' }

  try {
    const stripe = getStripe()
    const customerId = await getOrCreateStripeCustomer(ctx.orgId)
    const baseUrl = await getBaseUrl()

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/settings/billing?checkout=cancel`,
      // Links the session and the resulting subscription back to the org for
      // webhook resolution (belt-and-suspenders alongside the customer mapping).
      metadata: { org_id: ctx.orgId },
      subscription_data: { metadata: { org_id: ctx.orgId } },
      allow_promotion_codes: true,
    })

    if (!session.url) return { ok: false, error: 'Stripe did not return a checkout URL.' }
    return { ok: true, data: { url: session.url } }
  } catch (err) {
    console.error('[billing] createCheckoutSession failed:', err)
    return { ok: false, error: 'Could not start checkout. Please try again.' }
  }
}

/**
 * Create a Stripe Customer Portal session so an org admin can manage their
 * subscription, payment method, and cancellation on Stripe-hosted pages.
 */
export async function createPortalSession(): Promise<ActionResult<{ url: string }>> {
  const ctx = await getBillingContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!ctx.isAdmin) return { ok: false, error: 'Only org admins can manage billing.' }

  try {
    const stripe = getStripe()
    const customerId = await getOrCreateStripeCustomer(ctx.orgId)
    const baseUrl = await getBaseUrl()

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/settings/billing`,
    })

    return { ok: true, data: { url: session.url } }
  } catch (err) {
    console.error('[billing] createPortalSession failed:', err)
    return { ok: false, error: 'Could not open the billing portal. Please try again.' }
  }
}

/**
 * Create a one-time Stripe Checkout session (payment mode) to buy a Copilot credit
 * top-up package. Credits are granted by the webhook on `checkout.session.completed`
 * — never from the success redirect. The package key is opaque; the server maps it
 * to a price and the credited amount.
 */
export async function createCreditTopUpSession(
  packageKey: string,
): Promise<ActionResult<{ url: string }>> {
  const ctx = await getBillingContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!ctx.isAdmin) return { ok: false, error: 'Only org admins can manage billing.' }

  const priceId = topupPriceId(packageKey)
  if (!priceId) return { ok: false, error: 'Unknown or unconfigured credit package.' }

  try {
    const stripe = getStripe()
    const customerId = await getOrCreateStripeCustomer(ctx.orgId)
    const baseUrl = await getBaseUrl()

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/settings/billing?topup=success`,
      cancel_url: `${baseUrl}/settings/billing?topup=cancel`,
      // The webhook reads these to credit the right org with the right amount.
      metadata: { org_id: ctx.orgId, kind: 'copilot_topup', package: packageKey },
      payment_intent_data: {
        metadata: { org_id: ctx.orgId, kind: 'copilot_topup', package: packageKey },
      },
    })

    if (!session.url) return { ok: false, error: 'Stripe did not return a checkout URL.' }
    return { ok: true, data: { url: session.url } }
  } catch (err) {
    console.error('[billing] createCreditTopUpSession failed:', err)
    return { ok: false, error: 'Could not start checkout. Please try again.' }
  }
}
