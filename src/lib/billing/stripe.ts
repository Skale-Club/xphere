// Server-side Stripe client. NEVER import this in client components — the secret
// key must never reach the browser. Used by the checkout/portal server actions
// and the Stripe webhook receiver only.
import Stripe from 'stripe'

let cached: Stripe | null = null

/**
 * Returns the shared server-side Stripe client, constructed lazily from
 * STRIPE_SECRET_KEY. Throws if the key is missing so misconfiguration fails
 * loudly at the call site instead of producing silent auth errors.
 */
export function getStripe(): Stripe {
  if (cached) return cached

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not set — Stripe billing is not configured.')
  }

  cached = new Stripe(secretKey, {
    // Pin to the version bundled with the installed SDK so request/response
    // shapes match the TypeScript types.
    apiVersion: '2026-05-27.dahlia',
    appInfo: { name: 'Xphere', url: 'https://xphere.app' },
  })

  return cached
}

/** True when the platform has Stripe configured (used to gate billing UI). */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}
