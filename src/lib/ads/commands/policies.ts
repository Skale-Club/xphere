// Guardrails for ad changes.
//
// Two kinds of outcome:
//   blocked   — the change may not happen at all (hard ceiling, AI in
//               read-only mode, AI touching a protected campaign...).
//   approval  — the change may happen, but only after a holder of
//               `ads.approve` signs off on this exact diff.
//
// Policies come from ads_account_policies: an org-wide row (ad_account_id
// NULL, optionally per platform) and an optional per-account row that
// overrides it field by field. Anything unset falls back to DEFAULT_POLICY.
// ADS_MAX_DAILY_BUDGET stays as the deployment-wide last brake: no policy row
// can raise the ceiling above it.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { actsWithHumanAuthority, type AdsActor, type AdsPlatform, type PolicyFacts, type RiskLevel } from './types'

export type AiMode = 'read_only' | 'propose' | 'execute_with_confirmation'

export type EffectivePolicy = {
  maxDailyBudget: number
  maxBudgetIncreasePct: number
  allowEnable: boolean
  allowBiddingChanges: boolean
  allowBulk: boolean
  aiMode: AiMode
  /** Human changes at or above this risk need a separate `ads.approve` holder. */
  requireApprovalMinRisk: number
  approvalTtlMinutes: number
  protectedCampaignIds: string[]
}

const DEFAULT_GLOBAL_MAX_DAILY_BUDGET = 10_000

export function globalMaxDailyBudget(): number {
  const raw = Number(process.env.ADS_MAX_DAILY_BUDGET)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GLOBAL_MAX_DAILY_BUDGET
}

export function defaultPolicy(): EffectivePolicy {
  return {
    maxDailyBudget: globalMaxDailyBudget(),
    maxBudgetIncreasePct: 100,
    allowEnable: true,
    allowBiddingChanges: true,
    allowBulk: true,
    // The AI starts propose-only: it can prepare a diff, a human approves it
    // in the dashboard. An admin opts an account into MCP confirmation.
    aiMode: 'propose',
    requireApprovalMinRisk: 3,
    approvalTtlMinutes: 24 * 60,
    protectedCampaignIds: [],
  }
}

export type PolicyRow = {
  platform: string | null
  ad_account_id: string | null
  max_daily_budget: number | string | null
  max_budget_increase_pct: number | string | null
  allow_enable: boolean | null
  allow_bidding_changes: boolean | null
  allow_bulk: boolean | null
  ai_mode: string | null
  require_approval_min_risk: number | null
  approval_ttl_minutes: number | null
  protected_campaign_ids: string[] | null
}

function specificity(row: PolicyRow): number {
  return (row.platform ? 1 : 0) + (row.ad_account_id ? 2 : 0)
}

/**
 * Merge policy rows (least specific first) over the defaults. Pure, so the
 * precedence rules are testable without a database.
 */
export function mergePolicies(rows: PolicyRow[], platform: AdsPlatform, adAccountId: string): EffectivePolicy {
  const policy = defaultPolicy()
  const applicable = rows
    .filter((r) => (r.platform === null || r.platform === platform) && (r.ad_account_id === null || r.ad_account_id === adAccountId))
    .sort((a, b) => specificity(a) - specificity(b))

  const protectedIds = new Set<string>()
  for (const row of applicable) {
    if (row.max_daily_budget != null) policy.maxDailyBudget = Number(row.max_daily_budget)
    if (row.max_budget_increase_pct != null) policy.maxBudgetIncreasePct = Number(row.max_budget_increase_pct)
    if (row.allow_enable != null) policy.allowEnable = row.allow_enable
    if (row.allow_bidding_changes != null) policy.allowBiddingChanges = row.allow_bidding_changes
    if (row.allow_bulk != null) policy.allowBulk = row.allow_bulk
    if (row.ai_mode === 'read_only' || row.ai_mode === 'propose' || row.ai_mode === 'execute_with_confirmation') {
      policy.aiMode = row.ai_mode
    }
    if (row.require_approval_min_risk != null) policy.requireApprovalMinRisk = row.require_approval_min_risk
    if (row.approval_ttl_minutes != null) policy.approvalTtlMinutes = row.approval_ttl_minutes
    // Protection accumulates: an account row adds to the org list, it can't
    // quietly un-protect a campaign the org protected.
    for (const id of row.protected_campaign_ids ?? []) protectedIds.add(id)
  }
  policy.protectedCampaignIds = [...protectedIds]
  // The deployment ceiling always wins.
  policy.maxDailyBudget = Math.min(policy.maxDailyBudget, globalMaxDailyBudget())
  return policy
}

export async function loadEffectivePolicy(orgId: string, platform: AdsPlatform, adAccountId: string): Promise<EffectivePolicy> {
  const { data, error } = await createServiceRoleClient()
    .from('ads_account_policies')
    .select('platform, ad_account_id, max_daily_budget, max_budget_increase_pct, allow_enable, allow_bidding_changes, allow_bulk, ai_mode, require_approval_min_risk, approval_ttl_minutes, protected_campaign_ids')
    .eq('org_id', orgId)
  // Fail closed on the AI side: if policies can't be read, fall back to the
  // defaults (propose-only), never to something more permissive.
  if (error) return defaultPolicy()
  return mergePolicies((data ?? []) as PolicyRow[], platform, adAccountId)
}

export type PolicyViolation = { code: string; message: string }

export type PolicyVerdict = {
  blocked: PolicyViolation[]
  approvalReasons: PolicyViolation[]
  /** A human with ads.approve whose own confirmation satisfies the approval. */
  selfApprovable: boolean
}

export function evaluatePolicy(input: {
  policy: EffectivePolicy
  actor: AdsActor
  risk: RiskLevel
  campaignId: string | null
  facts: PolicyFacts
  /** Number of commands submitted together. */
  batchSize?: number
}): PolicyVerdict {
  const { policy, actor, risk, campaignId, facts } = input
  const blocked: PolicyViolation[] = []
  const approval: PolicyViolation[] = []
  const machine = !actsWithHumanAuthority(actor)

  if (machine && policy.aiMode === 'read_only') {
    blocked.push({ code: 'ai_read_only', message: 'This account only allows the AI to read, not to propose changes.' })
  }
  if (!machine && !actor.canManage) {
    blocked.push({ code: 'missing_permission', message: 'You do not have permission to manage ads (ads.manage).' })
  }

  if (facts.budgetAfter != null) {
    if (facts.budgetAfter > policy.maxDailyBudget) {
      blocked.push({
        code: 'budget_ceiling',
        message: `Daily budget ${facts.budgetAfter} exceeds the ${policy.maxDailyBudget} ceiling for this account.`,
      })
    } else if (facts.budgetBefore != null && facts.budgetBefore > 0) {
      const increasePct = ((facts.budgetAfter - facts.budgetBefore) / facts.budgetBefore) * 100
      if (increasePct > policy.maxBudgetIncreasePct) {
        approval.push({
          code: 'budget_increase',
          message: `Budget increase of ${increasePct.toFixed(0)}% exceeds the ${policy.maxBudgetIncreasePct}% limit per change.`,
        })
      }
    }
  }

  if (campaignId && policy.protectedCampaignIds.includes(campaignId)) {
    const v = { code: 'protected_campaign', message: 'This campaign is protected by the account policy.' }
    if (machine) blocked.push(v)
    else approval.push(v)
  }

  if (facts.enables && !policy.allowEnable) {
    const v = { code: 'enable_not_allowed', message: 'The account policy does not allow activating campaigns, ad sets or ads.' }
    if (machine) blocked.push(v)
    else approval.push(v)
  }

  if (facts.biddingChange && !policy.allowBiddingChanges) {
    const v = { code: 'bidding_not_allowed', message: 'The account policy does not allow bid or bidding-strategy changes.' }
    if (machine) blocked.push(v)
    else approval.push(v)
  }

  if ((input.batchSize ?? 1) > 1 && !policy.allowBulk) {
    const v = { code: 'bulk_not_allowed', message: 'The account policy does not allow bulk changes.' }
    if (machine) blocked.push(v)
    else approval.push(v)
  }

  if (machine) {
    // No autonomous AI mode exists: every AI or workflow change waits for a
    // human (dashboard) or an explicit confirmation of the previewed diff.
    approval.push({ code: 'machine_actor', message: 'Changes proposed by the AI or a workflow need confirmation.' })
  } else if (risk >= policy.requireApprovalMinRisk) {
    approval.push({ code: 'risk_level', message: `Risk level ${risk} changes need approval on this account.` })
  }

  return {
    blocked,
    approvalReasons: approval,
    selfApprovable: !machine && actor.canApprove,
  }
}
