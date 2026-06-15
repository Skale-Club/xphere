// Product catalog: the plans Xphere sells, what each unlocks (features), the
// limits it imposes, and the monthly Copilot credit allowance it includes.
//
// This is intentionally a CODE catalog (type-safe, versioned, reviewable) rather
// than a DB table: plans change rarely and as a product decision, while the
// per-org *overrides* (agency-assigned plan, granted credits, extended trial)
// live in the DB. Stripe Price IDs are NOT hardcoded here — each plan maps to an
// env var via resolvePriceId() in ./plans, so prices rotate without a code change.
//
// To add/retune a plan: edit PLAN_CATALOG and (if billable) set its STRIPE_PRICE_*
// env var. Nothing else in the billing layer needs to change.
import { resolvePriceId } from './plans'

/** Every gateable capability in the app. Map nav items / paid actions to these. */
export const ALL_FEATURES = [
  'crm', // contacts, companies, pipeline — the CRM core
  'chat', // omnichannel inbox / conversations
  'calls', // voice (Twilio / Vapi)
  'campaigns', // outbound campaigns
  'agents', // AI agent runtime / builder
  'workflows', // automations / flow builder
  'ads', // ads insights
  'copilot', // natural-language CRM copilot
  'knowledge', // knowledge base / embeddings
  'email_marketing',
  'projects',
  'prospects',
  'reviews',
  'calendar',
  'api', // public REST API + API keys
] as const

export type Feature = (typeof ALL_FEATURES)[number]

/** Countable, per-plan resource limits. `null` means unlimited. */
export type LimitKey = 'contacts' | 'members' | 'agents' | 'workflows'

export interface Plan {
  /** Stable key. Used as the STRIPE_PRICE_<KEY> env suffix and the override value. */
  key: string
  /** Human label shown in the UI. */
  name: string
  /** Whether this plan is purchasable via self-serve checkout. */
  purchasable: boolean
  /** Per-resource caps. `null` = unlimited. */
  limits: Record<LimitKey, number | null>
  /** Capabilities this plan unlocks. */
  features: readonly Feature[]
  /** Monthly Copilot credit allowance, in USD (matches copilot_runs.estimated_cost_usd). */
  copilotIncludedUsd: number
}

/** Days a brand-new org gets full access before requiring a paid plan. */
export const TRIAL_DAYS = 14

/** Which plan the trial grants while active. Trial users get this plan's entitlements. */
export const TRIAL_PLAN_KEY = 'pro'

/**
 * Display rate for credits: 1 credit = US$0.01. Internal accounting is always in
 * USD (precise, matches real cost); the UI multiplies by 100 to show round
 * "credit" numbers. Purely presentational — change freely.
 */
export const CREDIT_USD_RATE = 0.01

export const PLAN_CATALOG: Record<string, Plan> = {
  starter: {
    key: 'starter',
    name: 'Starter',
    purchasable: true,
    limits: { contacts: 1000, members: 3, agents: 1, workflows: 3 },
    features: ['crm', 'chat', 'calendar', 'knowledge', 'reviews'],
    copilotIncludedUsd: 5,
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    purchasable: true,
    limits: { contacts: 25000, members: 10, agents: 10, workflows: 50 },
    features: [
      'crm',
      'chat',
      'calls',
      'campaigns',
      'agents',
      'workflows',
      'ads',
      'copilot',
      'knowledge',
      'email_marketing',
      'projects',
      'prospects',
      'reviews',
      'calendar',
      'api',
    ],
    copilotIncludedUsd: 20,
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    purchasable: true,
    limits: { contacts: null, members: null, agents: null, workflows: null },
    features: ALL_FEATURES,
    copilotIncludedUsd: 100,
  },
}

/** Resolve a plan by key, or null when the key is unknown/unset. */
export function getPlan(key: string | null | undefined): Plan | null {
  if (!key) return null
  return PLAN_CATALOG[key] ?? null
}

/**
 * Reverse lookup: which plan owns this Stripe Price ID? Used by the webhook to
 * map a subscription's stripe_price_id back to a plan. Returns null if no
 * configured plan maps to the price.
 */
export function planByPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null
  for (const plan of Object.values(PLAN_CATALOG)) {
    if (resolvePriceId(plan.key) === priceId) return plan
  }
  return null
}

// ---------------------------------------------------------------------------
// Copilot credit top-up packages (one-time purchases when the monthly allowance
// runs out). Like plans, each maps to a STRIPE_PRICE_CREDITS_<KEY> env var.
// ---------------------------------------------------------------------------
export interface CreditPackage {
  key: string
  name: string
  /** Credits (USD) added to the balance on purchase. */
  creditsUsd: number
  /** Env var holding the Stripe Price ID for this one-time package. */
  stripePriceEnv: string
}

export const CREDIT_TOPUP_PACKAGES: Record<string, CreditPackage> = {
  small: { key: 'small', name: '$10 credits', creditsUsd: 10, stripePriceEnv: 'STRIPE_PRICE_CREDITS_SMALL' },
  medium: { key: 'medium', name: '$25 credits', creditsUsd: 25, stripePriceEnv: 'STRIPE_PRICE_CREDITS_MEDIUM' },
  large: { key: 'large', name: '$100 credits', creditsUsd: 100, stripePriceEnv: 'STRIPE_PRICE_CREDITS_LARGE' },
}

/** Resolve a top-up package's Stripe Price ID from its env var, or null. */
export function topupPriceId(pkgKey: string): string | null {
  const pkg = CREDIT_TOPUP_PACKAGES[pkgKey]
  if (!pkg) return null
  return process.env[pkg.stripePriceEnv] ?? null
}

/** Reverse lookup: which top-up package maps to this Stripe Price ID? */
export function topupByPriceId(priceId: string | null | undefined): CreditPackage | null {
  if (!priceId) return null
  for (const pkg of Object.values(CREDIT_TOPUP_PACKAGES)) {
    if (process.env[pkg.stripePriceEnv] === priceId) return pkg
  }
  return null
}

/** Top-up packages that have a configured Stripe price (purchasable right now). */
export function availableTopupPackages(): CreditPackage[] {
  return Object.values(CREDIT_TOPUP_PACKAGES).filter((p) => Boolean(process.env[p.stripePriceEnv]))
}
