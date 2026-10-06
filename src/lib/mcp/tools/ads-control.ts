// MCP tools for the Ads Control Plane — the AI side of the command engine.
//
// The flow an agent is expected to follow, and that the descriptions spell
// out: analyse (read tools) → ads_preview_change → show the diff to the
// operator → ads_approve_change only after they explicitly agree →
// ads_get_change_status. The agent never writes to Google, Meta or Google Business directly;
// every change is a ledger row with a policy verdict and a read-back.
//
// Whether an agent can confirm its own proposal is an account policy
// (ai_mode): 'propose' (default) means a human approves in Ads → Changes;
// 'execute_with_confirmation' lets the agent confirm by echoing the one-time
// token returned by the preview; 'read_only' blocks proposals entirely.

import { z } from 'zod'

import { mcpActor } from '@/lib/ads/commands/actors'
import { AdsCommandSchema, COMMAND_CATALOG } from '@/lib/ads/commands/catalog'
import {
  approveBatch,
  approveChange,
  cancelChange,
  getChange,
  listChanges,
  previewChange,
  rollbackChange,
  type ChangeView,
  type EngineFailure,
  type ExecutionSuccess,
  type PreviewSuccess,
} from '@/lib/ads/commands/engine'
import { loadEffectivePolicy } from '@/lib/ads/commands/policies'
import { KnowledgeRefsInputSchema, type KnowledgeRefInput } from '@/lib/knowledge/refs'
import type { ChangeStatus } from '@/lib/ads/commands/types'
import { resolveAdAccount, listActiveAdAccounts } from '@/lib/ads/ai-accounts'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import { listAdGroups, parseTokens, buildGaqlDateCondition } from '@/lib/ads/google-api'
import { listAds as listGoogleAds, listKeywords, listNegativeKeywords, listSearchTerms } from '@/lib/ads/google-reads'
import { listAds as listMetaAds, listAdSetsDetailed } from '@/lib/ads/meta-api'
import { randomUUID } from 'node:crypto'
import type { McpToolDef } from '../tool-types'

const StatusSchema = z.enum([
  'draft', 'validating', 'awaiting_approval', 'queued', 'executing', 'verifying',
  'succeeded', 'failed', 'drifted', 'cancelled', 'expired',
])

const NEXT_STEP_PENDING =
  'Show the operator the diff, warnings and approval_reasons above and ask them to confirm. Only after an explicit yes, call ads_approve_change with change_id and confirmation_token. Never approve on your own initiative.'

/**
 * Optional "why" of a proposal. Not required (other clients exist), but an AI
 * client is told to send it: the outcome reviewer files what happened against
 * exactly these references ~7 days after the change is applied.
 */
const GroundingInput = {
  rationale: z
    .string()
    .max(2000)
    .optional()
    .describe('Why you propose this change, in 1-3 sentences: the evidence (metrics, search terms) and the expected effect. Stored on the ledger and quoted in the outcome review.'),
  knowledge_refs: KnowledgeRefsInputSchema.optional().describe(
    'Global Knowledge sources that grounded this proposal — pass source_id (global_knowledge_source_id) and source_name from global_knowledge_search results you actually relied on.',
  ),
  memory_ids: z
    .array(z.string().uuid())
    .max(20)
    .optional()
    .describe('ids of ads memories (ads_search_memories) that informed this proposal, e.g. a past result of a similar change.'),
}

type GroundingArgs = { rationale?: string; knowledge_refs?: KnowledgeRefInput[]; memory_ids?: string[] }

function grounding(args: GroundingArgs) {
  return { rationale: args.rationale, knowledgeRefs: args.knowledge_refs, memoryRefs: args.memory_ids }
}

/** Short outcome for list/preview responses; ads_get_change_status returns the full object. */
function outcomeBrief(change: ChangeView) {
  const o = change.outcome
  if (!o) return null
  if (o.status === 'measured' || o.status === 'no_data') {
    return {
      status: o.status,
      summary: o.summary,
      windows: o.windows,
      memory_id: o.memory_id,
      confounders: o.confounders.length,
      reviewed_at: change.outcome_reviewed_at,
    }
  }
  return { status: o.status, reviewed_at: change.outcome_reviewed_at }
}

function compact(change: ChangeView, opts: { fullOutcome?: boolean } = {}) {
  return {
    change_id: change.id,
    status: change.status,
    platform: change.platform,
    ad_account_id: change.ad_account_id,
    action: change.label,
    command_type: change.command_type,
    resource: change.resource_name ?? change.resource_id,
    campaign_id: change.campaign_id,
    risk_level: change.risk_level,
    diff: change.diff.map((d) => ({ field: d.label, before: d.beforeDisplay, after: d.afterDisplay })),
    warnings: change.warnings,
    approval_required: change.approval_required,
    approval_reasons: change.approval_reasons.map((r) => r.message),
    approval_expires_at: change.approval_expires_at,
    approved_by: change.approved_by_label,
    attempts: change.attempt_count,
    next_attempt_at: change.next_attempt_at,
    error: change.error_message ? { code: change.error_code, message: change.error_message } : null,
    verification: change.verification,
    rollback_of: change.rollback_of,
    batch_id: change.batch_id,
    created_at: change.created_at,
    completed_at: change.completed_at,
    external_drift: change.external_drift_detected_at
      ? { detected_at: change.external_drift_detected_at, detail: change.external_drift, note: 'The platform no longer matches this change — it was edited outside Xphere after being applied.' }
      : null,
    rationale: change.rationale,
    knowledge_refs: change.knowledge_refs,
    memory_ids: change.memory_refs,
    outcome: opts.fullOutcome
      ? change.outcome
        ? { ...change.outcome, reviewed_at: change.outcome_reviewed_at }
        : null
      : outcomeBrief(change),
  }
}

function failure(result: EngineFailure) {
  return {
    error: result.code,
    detail: result.message,
    ...(result.violations ? { violations: result.violations.map((v) => v.message) } : {}),
    ...(result.change ? { change: compact(result.change) } : {}),
  }
}

async function previewResponse(orgId: string, result: PreviewSuccess | EngineFailure) {
  if (!result.ok) return failure(result)
  const { change } = result
  const policy = await loadEffectivePolicy(orgId, change.platform, change.ad_account_id)
  return {
    ...compact(change),
    duplicate: result.duplicate,
    confirmation_token: result.confirmationToken ?? null,
    ai_mode: policy.aiMode,
    next_step:
      change.status !== 'awaiting_approval'
        ? `This change is already ${change.status}.`
        : policy.aiMode === 'execute_with_confirmation'
          ? NEXT_STEP_PENDING
          : 'This account requires a human to approve AI-proposed changes. Tell the operator the change is waiting in Xphere → Ads → Changes; do not try to approve it yourself.',
  }
}

function executionResponse(result: ExecutionSuccess | EngineFailure) {
  if (!result.ok) return failure(result)
  const view = compact(result.change)
  const note: Record<ChangeStatus, string> = {
    succeeded: 'Applied and verified on the platform.',
    drifted: 'The platform accepted the change but reads back a different value — report this to the operator.',
    queued: 'Queued for a retry after a temporary platform error; check again with ads_get_change_status.',
    failed: 'The change failed; see error.',
    awaiting_approval: 'Waiting for approval.',
    executing: 'Executing.',
    verifying: 'Verifying.',
    draft: 'Draft.',
    validating: 'Validating.',
    cancelled: 'Cancelled.',
    expired: 'Expired.',
  }
  return { ...view, summary: note[result.change.status] }
}

export const adsControlTools: McpToolDef[] = [
  // ─── Capabilities ───────────────────────────────────────────────────────────
  {
    name: 'ads_get_capabilities',
    title: 'Get ads editing capabilities',
    description:
      'List every guarded change Xphere can make on Google Ads, Meta Ads and Google Business Profile (command types, risk level 1-4) and the policy for each connected target. Call this before proposing a write. Google Business targets use accounts/{account}/locations/{location}; budget fields in their policy are irrelevant, while ai_mode, approval threshold, bulk permission and expiry still apply.',
    area: 'general_xphere',
    inputSchema: z.object({ platform: z.enum(['meta', 'google', 'google_business']).optional() }).strict(),
    handler: async ({ platform }, { auth }) => {
      const platforms = platform ? [platform] : (['google', 'meta', 'google_business'] as const)
      const commands = Object.entries(COMMAND_CATALOG)
        .filter(([, e]) => platforms.includes(e.platform))
        .map(([type, e]) => ({ type, platform: e.platform, resource: e.resourceType, risk: e.risk, label: e.label }))
      const accounts = []
      for (const p of platforms) {
        for (const acc of await listActiveAdAccounts(auth.orgId, p)) {
          const policy = await loadEffectivePolicy(auth.orgId, p, acc.ad_account_id)
          accounts.push({
            platform: p,
            ad_account_id: acc.ad_account_id,
            ad_account_name: acc.ad_account_name,
            policy: {
              ai_mode: policy.aiMode,
              max_daily_budget: policy.maxDailyBudget,
              max_budget_increase_pct: policy.maxBudgetIncreasePct,
              allow_enable: policy.allowEnable,
              allow_bidding_changes: policy.allowBiddingChanges,
              allow_bulk: policy.allowBulk,
              approval_ttl_minutes: policy.approvalTtlMinutes,
              protected_campaign_ids: policy.protectedCampaignIds,
            },
          })
        }
      }
      return {
        commands,
        accounts,
        risk_levels: {
          1: 'reversible: name, status, budget, dates',
          2: 'targeting: keywords, negatives, audience, geo, placements',
          3: 'strategy: bids, bidding strategy',
          4: 'structural: creates, duplicates and destructive changes; approval required',
        },
        workflow:
          'Read → ground: global_knowledge_search for the relevant lessons/playbooks and ads_search_memories (with a query) for past results of similar changes → ads_preview_change with `rationale` (why, citing the evidence) + `knowledge_refs` (the global_knowledge_search sources you relied on: source_id + source_name) + `memory_ids` (memories you relied on) → show the diff and the rationale to the operator → only after they confirm, ads_approve_change → ads_get_change_status. About 7 days after a change is applied Xphere reviews its outcome automatically (campaign metrics 7 days before vs 7 days after), writes it to the change (`outcome`) and files a "result" memory linked to the knowledge you cited — check those results before repeating a similar change. Money in ad commands is always in major units of the account currency.',
      }
    },
  },

  // ─── Google Ads reads ───────────────────────────────────────────────────────
  {
    name: 'ads_google_list_ad_groups',
    title: 'List Google Ads ad groups',
    description: 'Ad groups with status and cost/clicks for the period. Use to find ad_group_id values for keyword and bid commands.',
    area: 'general_xphere',
    inputSchema: z
      .object({ customer_id: z.string().optional(), campaign_id: z.string().optional(), date_preset: z.string().default('last_30d') })
      .strict(),
    handler: async ({ customer_id, campaign_id, date_preset }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const rt = parseTokens(conn.token).refresh_token
        const groups = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          listAdGroups(conn.accountId, rt, buildGaqlDateCondition(date_preset), campaign_id),
        )
        return {
          customer_id: conn.accountId,
          ad_groups: groups.map((g) => ({
            ad_group_id: g.id,
            name: g.name,
            status: g.status,
            campaign_id: g.campaignId,
            campaign_name: g.campaignName,
            impressions: Number(g.impressions),
            clicks: Number(g.clicks),
            cost: Number(g.costMicros) / 1_000_000,
          })),
        }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
  {
    name: 'ads_google_search_terms',
    title: 'Google Ads search terms report',
    description:
      'The actual searches that triggered ads, with the keyword they matched, cost, clicks and conversions, sorted by cost. status tells whether the term is already a keyword (ADDED) or excluded (EXCLUDED). Use it to find negative-keyword candidates (spend with no conversions, irrelevant intent) and new keyword ideas.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        customer_id: z.string().optional(),
        campaign_id: z.string().optional(),
        ad_group_id: z.string().optional(),
        date_preset: z.string().default('last_30d'),
        limit: z.number().int().min(1).max(1000).default(200),
      })
      .strict(),
    handler: async ({ customer_id, campaign_id, ad_group_id, date_preset, limit }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const terms = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          listSearchTerms({
            customerId: conn.accountId,
            refreshToken: parseTokens(conn.token).refresh_token,
            datePreset: date_preset,
            campaignId: campaign_id,
            adGroupId: ad_group_id,
            limit,
          }),
        )
        return { customer_id: conn.accountId, date_preset, search_terms: terms, count: terms.length }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
  {
    name: 'ads_google_list_keywords',
    title: 'List Google Ads keywords',
    description: 'Keywords (not negatives) with criterion_id, match type, status, max CPC, quality score and period metrics. criterion_id + ad_group_id identify a keyword in keyword commands.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        customer_id: z.string().optional(),
        campaign_id: z.string().optional(),
        ad_group_id: z.string().optional(),
        date_preset: z.string().default('last_30d'),
      })
      .strict(),
    handler: async ({ customer_id, campaign_id, ad_group_id, date_preset }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const keywords = await listKeywords({
          customerId: conn.accountId,
          refreshToken: parseTokens(conn.token).refresh_token,
          datePreset: date_preset,
          campaignId: campaign_id,
          adGroupId: ad_group_id,
        })
        return { customer_id: conn.accountId, keywords, count: keywords.length }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
  {
    name: 'ads_google_list_negative_keywords',
    title: 'List Google Ads negative keywords',
    description: 'Campaign-level and ad-group-level negative keywords, with the criterion_id needed to remove one.',
    area: 'general_xphere',
    inputSchema: z.object({ customer_id: z.string().optional(), campaign_id: z.string().optional() }).strict(),
    handler: async ({ customer_id, campaign_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const negatives = await listNegativeKeywords({
          customerId: conn.accountId,
          refreshToken: parseTokens(conn.token).refresh_token,
          campaignId: campaign_id,
        })
        return { customer_id: conn.accountId, negative_keywords: negatives, count: negatives.length }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
  {
    name: 'ads_google_list_ads',
    title: 'List Google Ads ads',
    description: 'Ads with type, final URLs, status, policy approval status and period metrics.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        customer_id: z.string().optional(),
        campaign_id: z.string().optional(),
        ad_group_id: z.string().optional(),
        date_preset: z.string().default('last_30d'),
      })
      .strict(),
    handler: async ({ customer_id, campaign_id, ad_group_id, date_preset }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const ads = await listGoogleAds({
          customerId: conn.accountId,
          refreshToken: parseTokens(conn.token).refresh_token,
          datePreset: date_preset,
          campaignId: campaign_id,
          adGroupId: ad_group_id,
        })
        return { customer_id: conn.accountId, ads, count: ads.length }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  // ─── Meta reads ─────────────────────────────────────────────────────────────
  {
    name: 'ads_meta_list_adsets',
    title: 'List Meta ad sets',
    description:
      'Meta ad sets with status, budget (major units; null when the campaign uses a campaign budget/CBO), bid strategy, optimization goal, schedule and the targeting summary (ages, genders, countries, placements). Use to find adset_id values for ad set commands.',
    area: 'general_xphere',
    inputSchema: z.object({ ad_account_id: z.string().optional(), campaign_id: z.string().optional() }).strict(),
    handler: async ({ ad_account_id, campaign_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'meta', ad_account_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const adsets = await withConnectionHealth({ orgId: auth.orgId, platform: 'meta', adAccountId: conn.accountId }, () =>
          listAdSetsDetailed(conn.accountId, conn.token, campaign_id),
        )
        return {
          ad_account_id: conn.accountId,
          adsets: adsets.map((a) => {
            const t = (a.targeting ?? {}) as {
              age_min?: number
              age_max?: number
              genders?: number[]
              geo_locations?: { countries?: string[]; regions?: unknown[]; cities?: unknown[] }
              publisher_platforms?: string[]
            }
            return {
              adset_id: a.id,
              name: a.name,
              campaign_id: a.campaign_id,
              status: a.status,
              effective_status: a.effective_status,
              daily_budget_minor_units: a.daily_budget ?? null,
              lifetime_budget_minor_units: a.lifetime_budget ?? null,
              bid_strategy: a.bid_strategy ?? null,
              bid_amount_minor_units: a.bid_amount ?? null,
              optimization_goal: a.optimization_goal ?? null,
              start_time: a.start_time ?? null,
              end_time: a.end_time ?? null,
              targeting: {
                age_min: t.age_min ?? null,
                age_max: t.age_max ?? null,
                genders: t.genders ?? [],
                countries: t.geo_locations?.countries ?? [],
                has_regions_or_cities: Boolean(t.geo_locations?.regions?.length || t.geo_locations?.cities?.length),
                publisher_platforms: t.publisher_platforms ?? 'automatic (Advantage+ placements)',
              },
            }
          }),
          note: 'Budgets and bids here are in minor units (cents) as Meta returns them; commands take major units.',
        }
      } catch (e) {
        return { error: 'meta_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
  {
    name: 'ads_meta_list_ads',
    title: 'List Meta ads',
    description: 'Meta ads with status and creative summary. Use to find ad_id values for ad commands.',
    area: 'general_xphere',
    inputSchema: z.object({ ad_account_id: z.string().optional(), adset_id: z.string().optional() }).strict(),
    handler: async ({ ad_account_id, adset_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'meta', ad_account_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const ads = await listMetaAds(conn.accountId, conn.token, adset_id)
        return {
          ad_account_id: conn.accountId,
          ads: ads.map((a) => ({
            ad_id: a.id,
            name: a.name,
            adset_id: a.adset_id,
            status: a.status,
            effective_status: a.effective_status,
            creative: a.creative ? { id: a.creative.id, title: a.creative.title, body: a.creative.body } : null,
          })),
        }
      } catch (e) {
        return { error: 'meta_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  // ─── Change lifecycle ───────────────────────────────────────────────────────
  {
    name: 'ads_preview_change',
    title: 'Preview an ads change',
    description:
      'Propose ONE change to Google Ads, Meta Ads or Google Business Profile. Nothing is written: Xphere reads the current state, computes the before→after diff, checks policy, performs provider preflight when supported, and records it as awaiting approval. Returns change_id, diff, warnings, approval_reasons and possibly a one-time confirmation_token. You MUST show the diff to the operator and get an explicit yes before calling ads_approve_change. Before proposing, call global_knowledge_search (and ads_search_memories with a query) and pass `rationale` plus `knowledge_refs`/`memory_ids` citing what grounded the change: ~7 days after it is applied the outcome is reviewed automatically and filed as a result memory against those references. Google Business targets use accounts/{account}/locations/{location}.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: z.object({ command: AdsCommandSchema, ...GroundingInput }).strict(),
    handler: async ({ command, ...why }, { auth }) => {
      const result = await previewChange({ orgId: auth.orgId, actor: mcpActor(auth), command, ...grounding(why) })
      return previewResponse(auth.orgId, result)
    },
  },
  {
    name: 'ads_preview_changes',
    title: 'Preview a batch of ads changes',
    description:
      'Propose several changes at once (max 20), e.g. a list of negative keywords from a search-terms review. Each item uses exactly the `command` shape of ads_preview_change. Each command becomes its own change (one bad item never blocks the rest), grouped by batch_id. The top-level `rationale`, `knowledge_refs` and `memory_ids` apply to every item; the batch\'s outcome is reviewed as one unit ~7 days after it is applied. Same rules as ads_preview_change: ground the proposal first, show the operator every diff and get an explicit yes before approving.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    // Each item has exactly the shape of ads_preview_change's `command`. The full
    // Full command schema is published once (on ads_preview_change) rather than
    // twice — it is ~45 KB of JSON Schema in every client's context. Items are
    // validated by the same parser inside previewChange, with per-item errors.
    inputSchema: z
      .object({ commands: z.array(z.record(z.string(), z.unknown())).min(1).max(20), ...GroundingInput })
      .strict(),
    handler: async ({ commands, ...why }, { auth }) => {
      const actor = mcpActor(auth)
      const batchId = randomUUID()
      const results = []
      for (const command of commands) {
        const result = await previewChange({
          orgId: auth.orgId,
          actor,
          command,
          batchId,
          batchSize: commands.length,
          ...grounding(why),
        })
        results.push(result.ok ? await previewResponse(auth.orgId, result) : failure(result))
      }
      return {
        batch_id: batchId,
        total: results.length,
        ready: results.filter((r) => !('error' in r)).length,
        results,
        next_step: NEXT_STEP_PENDING,
      }
    },
  },
  {
    name: 'ads_approve_change',
    title: 'Approve and apply an ads change',
    description:
      'Apply a change you previewed, AFTER the operator explicitly confirmed the diff. Requires the confirmation_token from the preview (it binds the approval to that exact diff). Only works on accounts whose policy ai_mode is execute_with_confirmation; otherwise the operator approves in Xphere → Ads → Changes. If the resource changed since the preview, this fails with state_conflict — preview again. Returns the final status after the write and read-back verification.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: z.object({ change_id: z.string().uuid(), confirmation_token: z.string().min(10) }).strict(),
    handler: async ({ change_id, confirmation_token }, { auth }) => {
      const result = await approveChange({
        orgId: auth.orgId,
        changeId: change_id,
        actor: mcpActor(auth),
        confirmationToken: confirmation_token,
      })
      return executionResponse(result)
    },
  },
  {
    name: 'ads_approve_changes',
    title: 'Approve and apply a batch of ads changes',
    description:
      'Apply every pending change of a batch returned by ads_preview_changes, AFTER the operator explicitly confirmed the whole list. Pass the batch_id and a map of change_id → confirmation_token from the preview. Changes run one by one; each keeps its own policy, conflict and read-back checks, and one failure does not stop the rest. Same ai_mode rule as ads_approve_change.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: z
      .object({
        batch_id: z.string().uuid(),
        confirmation_tokens: z.record(z.string().uuid(), z.string().min(10)),
      })
      .strict(),
    handler: async ({ batch_id, confirmation_tokens }, { auth }) => {
      const { results } = await approveBatch({
        orgId: auth.orgId,
        batchId: batch_id,
        actor: mcpActor(auth),
        confirmationTokens: confirmation_tokens,
      })
      return {
        batch_id,
        total: results.length,
        applied: results.filter((r) => r.ok && r.change.status === 'succeeded').length,
        results: results.map((r) => (r.ok ? executionResponse(r) : { change_id: r.change_id, ...failure(r) })),
      }
    },
  },
  {
    name: 'ads_get_change_status',
    title: 'Get ads change status',
    description:
      'Current status of a change (awaiting_approval, queued, succeeded, failed, drifted, ...), its diff, verification result, event log, the rationale and knowledge it was proposed with, and — once reviewed, ~7 days after it was applied — its outcome: campaign metrics 7 days before vs after, percent deltas, other changes in the same window (confounders) and the id of the result memory.',
    area: 'general_xphere',
    inputSchema: z.object({ change_id: z.string().uuid() }).strict(),
    handler: async ({ change_id }, { auth }) => {
      const result = await getChange(auth.orgId, change_id)
      if (!result) return { error: 'not_found', detail: 'Change not found in this organization.' }
      return {
        ...compact(result.change, { fullOutcome: true }),
        events: result.events.map((e) => ({
          at: e.created_at,
          event: e.event_type,
          to: e.to_status,
          by: e.actor_label,
          detail: e.detail,
        })),
      }
    },
  },
  {
    name: 'ads_list_changes',
    title: 'List ads changes',
    description:
      'Change history and pending approvals for the organization, newest first, with each change\'s rationale, cited knowledge and outcome summary (when reviewed). Filter by status, platform, account or campaign — e.g. status ["succeeded"] + campaign_id to see what was tried on a campaign and how it went.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        status: z.array(StatusSchema).optional(),
        platform: z.enum(['meta', 'google', 'google_business']).optional(),
        ad_account_id: z.string().optional(),
        campaign_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .strict(),
    handler: async ({ status, platform, ad_account_id, campaign_id, limit }, { auth }) => {
      const changes = await listChanges(auth.orgId, {
        status,
        platform,
        adAccountId: ad_account_id,
        campaignId: campaign_id,
        limit,
      })
      return { changes: changes.map((c) => compact(c)), count: changes.length }
    },
  },
  {
    name: 'ads_cancel_change',
    title: 'Cancel a pending ads change',
    description: 'Cancel a change you proposed that has not been applied yet (awaiting_approval or queued).',
    area: 'general_xphere',
    inputSchema: z.object({ change_id: z.string().uuid(), reason: z.string().max(500).optional() }).strict(),
    handler: async ({ change_id, reason }, { auth }) => {
      const result = await cancelChange({ orgId: auth.orgId, changeId: change_id, actor: mcpActor(auth), reason })
      return result.ok ? compact(result.change) : failure(result)
    },
  },
  {
    name: 'ads_rollback_change',
    title: 'Propose rolling back an ads change',
    description:
      'Propose the inverse of an applied change (restore the previous status, budget, name or bid; pause a keyword that was added; remove a negative that was added). This only PREVIEWS the rollback as a new change — it follows the same approval flow as ads_preview_change. History is never rewritten.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: z
      .object({
        change_id: z.string().uuid(),
        rationale: z.string().max(2000).optional().describe('Why the change is being rolled back (e.g. its reviewed outcome).'),
      })
      .strict(),
    handler: async ({ change_id, rationale }, { auth }) => {
      const result = await rollbackChange({ orgId: auth.orgId, changeId: change_id, actor: mcpActor(auth), rationale })
      return previewResponse(auth.orgId, result)
    },
  },
]
