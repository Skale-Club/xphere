// Shared vocabulary for the Ads Command Engine.
//
// A "command" is one intended change to one ad-platform resource. Every write
// to Google Ads or Meta Ads — from the dashboard, the MCP server, the Copilot
// or a workflow — is expressed as a command and runs through engine.ts, which
// is the only module allowed to call a provider adapter's execute().

export type AdsPlatform = 'meta' | 'google'

export type ChangeStatus =
  | 'draft'
  | 'validating'
  | 'awaiting_approval'
  | 'queued'
  | 'executing'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'drifted'
  | 'cancelled'
  | 'expired'

export const TERMINAL_STATUSES: readonly ChangeStatus[] = [
  'succeeded',
  'failed',
  'drifted',
  'cancelled',
  'expired',
]

export type ActorType = 'user' | 'ai' | 'workflow' | 'system'

/**
 * Who is asking. Permissions are resolved by the caller (dashboard session via
 * RBAC, MCP token, cron) before reaching the engine — the engine never looks
 * up a session itself, so it behaves identically in every entry point.
 */
export type AdsActor = {
  type: ActorType
  /** auth.users id when a human is behind the request (dashboard, MCP OAuth). */
  id: string | null
  /** Stable, human-readable identifier for audit rows ("user:<id>", "mcp:xph_ab12"). */
  label: string
  /** Holds `ads.manage` — may request changes. */
  canManage: boolean
  /** Holds `ads.approve` — a human whose own submit counts as approval. */
  canApprove: boolean
}

/**
 * 1 reversible (name, status, budget, dates)
 * 2 targeting (keywords, negatives, audience, geo, placements)
 * 3 strategy (bids, bidding strategy, conversion goals)
 * 4 structural (duplication, creatives, new structures)
 */
export type RiskLevel = 1 | 2 | 3 | 4

export type ResourceType =
  | 'campaign'
  | 'ad_group'
  | 'ad'
  | 'keyword'
  | 'negative_keyword'
  | 'adset'
  | 'campaign_criterion'
  | 'conversion_action'
  | 'asset'
  | 'user_list'
  | 'media'

/** The provider's view of a resource right before a change. */
export type ResourceSnapshot = {
  resourceType: ResourceType
  resourceId: string | null
  resourceName: string | null
  campaignId: string | null
  currency: string
  /**
   * Exactly the fields the command reads or writes. This — and only this — is
   * hashed for optimistic concurrency, so an unrelated edit elsewhere on the
   * campaign does not invalidate an approved change.
   */
  fields: Record<string, unknown>
}

export type DiffEntry = {
  field: string
  label: string
  before: unknown
  after: unknown
  /** Formatted for display (currency, enum labels). */
  beforeDisplay: string
  afterDisplay: string
}

export type PlanResult =
  | {
      ok: true
      intended: Record<string, unknown>
      diff: DiffEntry[]
      warnings: string[]
      /** Extra policy facts derived from the snapshot (budget delta, enabling...). */
      facts: PolicyFacts
    }
  | { ok: false; code: string; message: string }

export type PolicyFacts = {
  /** Budget change in major units, when the command sets a budget. */
  budgetBefore?: number | null
  budgetAfter?: number | null
  /** The command turns something on that is currently off. */
  enables?: boolean
  /** The command changes bids or bidding strategy. */
  biddingChange?: boolean
}
