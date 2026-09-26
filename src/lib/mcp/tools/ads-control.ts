// MCP tools for the Ads Control Plane — the AI side of the command engine.
//
// The flow an agent is expected to follow, and that the descriptions spell
// out: analyse (read tools) → ads_preview_change → show the diff to the
// operator → ads_approve_change only after they explicitly agree →
// ads_get_change_status. The agent never writes to Google or Meta directly;
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

function compact(change: ChangeView) {
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
      'List every change Xphere can make on Google Ads and Meta Ads (command types, risk level 1-4) and, for each connected ad account, the guardrail policy that applies: ai_mode (read_only / propose / execute_with_confirmation), budget ceiling, max budget increase per change, whether activating or bidding changes are allowed, protected campaigns. Call this before proposing changes to an account.',
    area: 'general_xphere',
    inputSchema: z.object({ platform: z.enum(['meta', 'google']).optional() }).strict(),
    handler: async ({ platform }, { auth }) => {
      const platforms = platform ? [platform] : (['google', 'meta'] as const)
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
          4: 'structural (not yet available)',
        },
        workflow:
          'Read → ads_preview_change (returns diff + change_id + confirmation_token) → show the diff to the operator → only after they confirm, ads_approve_change → ads_get_change_status. Money is always in major units of the account currency (e.g. 50 = R$50).',
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
      'Propose ONE change to a Google Ads or Meta Ads account. Nothing is written to the platform: Xphere reads the current state, computes the before→after diff, checks the account policy, asks the platform to validate the change, and records it as awaiting approval. Returns change_id, diff, warnings, approval_reasons and (when the account allows AI confirmation) a one-time confirmation_token. You MUST show the diff to the operator and get an explicit yes before calling ads_approve_change. Money is in major units of the account currency.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: z.object({ command: AdsCommandSchema }).strict(),
    handler: async ({ command }, { auth }) => {
      const result = await previewChange({ orgId: auth.orgId, actor: mcpActor(auth), command })
      return previewResponse(auth.orgId, result)
    },
  },
  {
    name: 'ads_preview_changes',
    title: 'Preview a batch of ads changes',
    description:
      'Propose several changes at once (max 20), e.g. a list of negative keywords from a search-terms review. Each command becomes its own change (one bad item never blocks the rest), grouped by batch_id. Same rules as ads_preview_change: show the operator every diff and get an explicit yes before approving.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: z.object({ commands: z.array(AdsCommandSchema).min(1).max(20) }).strict(),
    handler: async ({ commands }, { auth }) => {
      const actor = mcpActor(auth)
      const batchId = randomUUID()
      const results = []
      for (const command of commands) {
        const result = await previewChange({ orgId: auth.orgId, actor, command, batchId, batchSize: commands.length })
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
    name: 'ads_get_change_status',
    title: 'Get ads change status',
    description: 'Current status of a change (awaiting_approval, queued, succeeded, failed, drifted, ...), its diff, verification result and event log.',
    area: 'general_xphere',
    inputSchema: z.object({ change_id: z.string().uuid() }).strict(),
    handler: async ({ change_id }, { auth }) => {
      const result = await getChange(auth.orgId, change_id)
      if (!result) return { error: 'not_found', detail: 'Change not found in this organization.' }
      return {
        ...compact(result.change),
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
    description: 'Change history and pending approvals for the organization, newest first. Filter by status, platform, account or campaign.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        status: z.array(StatusSchema).optional(),
        platform: z.enum(['meta', 'google']).optional(),
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
      return { changes: changes.map(compact), count: changes.length }
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
    inputSchema: z.object({ change_id: z.string().uuid() }).strict(),
    handler: async ({ change_id }, { auth }) => {
      const result = await rollbackChange({ orgId: auth.orgId, changeId: change_id, actor: mcpActor(auth) })
      return previewResponse(auth.orgId, result)
    },
  },
]
