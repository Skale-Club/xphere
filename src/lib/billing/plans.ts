// Server-side pricing authority.
//
// The client NEVER sends a price/amount. It sends a plan KEY (an opaque string
// like "pro"), and the server maps that key to a Stripe Price ID it controls.
// Prices are configured via env vars so plans can change without code changes
// and without a schema rewrite — keeping the foundation product-change-ready.
//
// Env convention:  STRIPE_PRICE_<UPPERCASE_KEY>   e.g. STRIPE_PRICE_PRO=price_123
//
// This is intentionally minimal: the actual catalog of plans Xphere sells is a
// product decision layered on top of this foundation (a DB-backed plans table,
// an admin UI, etc. can replace this resolver later without touching checkout,
// customer mapping, or the webhook).

export type PlanKey = string

/** Resolve a plan key to a server-controlled Stripe Price ID, or null if unknown. */
export function resolvePriceId(planKey: PlanKey): string | null {
  const normalized = planKey.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')
  if (!normalized) return null
  return process.env[`STRIPE_PRICE_${normalized}`] ?? null
}

/** List the plan keys that currently have a configured Stripe price. */
export function configuredPlanKeys(): string[] {
  return Object.keys(process.env)
    .filter((k) => k.startsWith('STRIPE_PRICE_') && process.env[k])
    .map((k) => k.slice('STRIPE_PRICE_'.length).toLowerCase())
}
