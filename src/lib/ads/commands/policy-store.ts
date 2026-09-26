import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import { defaultPolicy, mergePolicies, type EffectivePolicy, type PolicyRow } from './policies'
import type { AdsPlatform } from './types'

export type PolicyDbRow = Database['public']['Tables']['ads_account_policies']['Row']

/** One policy scope's editable fields. null = inherit from the broader scope. */
export const PolicyInputSchema = z
  .object({
    platform: z.enum(['meta', 'google']).nullable().default(null),
    ad_account_id: z.string().min(1).max(64).nullable().default(null),
    max_daily_budget: z.number().positive().max(10_000_000).nullable().optional(),
    max_budget_increase_pct: z.number().positive().max(10_000).nullable().optional(),
    allow_enable: z.boolean().nullable().optional(),
    allow_bidding_changes: z.boolean().nullable().optional(),
    allow_bulk: z.boolean().nullable().optional(),
    ai_mode: z.enum(['read_only', 'propose', 'execute_with_confirmation']).nullable().optional(),
    require_approval_min_risk: z.number().int().min(1).max(5).nullable().optional(),
    approval_ttl_minutes: z.number().int().min(5).max(10_080).nullable().optional(),
    protected_campaign_ids: z.array(z.string().regex(/^\d+$/)).max(500).optional(),
  })
  .strict()
  .refine((v) => v.ad_account_id === null || v.platform !== null, {
    message: 'platform is required when ad_account_id is set',
  })

export type PolicyInput = z.infer<typeof PolicyInputSchema>

export async function listPolicyRows(orgId: string): Promise<PolicyDbRow[]> {
  const { data } = await createServiceRoleClient()
    .from('ads_account_policies')
    .select('*')
    .eq('org_id', orgId)
    .order('platform', { nullsFirst: true })
    .order('ad_account_id', { nullsFirst: true })
  return data ?? []
}

/**
 * Upsert one scope. The unique index is on COALESCE expressions, which
 * PostgREST's on_conflict can't target, so this is select-then-write.
 */
export async function upsertPolicy(orgId: string, input: PolicyInput, userId: string | null): Promise<PolicyDbRow> {
  const db = createServiceRoleClient()
  let q = db.from('ads_account_policies').select('id').eq('org_id', orgId)
  q = input.platform === null ? q.is('platform', null) : q.eq('platform', input.platform)
  q = input.ad_account_id === null ? q.is('ad_account_id', null) : q.eq('ad_account_id', input.ad_account_id)
  const { data: existing } = await q.maybeSingle()

  const { platform, ad_account_id, ...fields } = input
  const values = { ...fields, updated_by: userId }

  const result = existing
    ? await db.from('ads_account_policies').update(values).eq('id', existing.id).select('*').single()
    : await db.from('ads_account_policies').insert({ org_id: orgId, platform, ad_account_id, ...values }).select('*').single()

  if (result.error || !result.data) throw new Error(result.error?.message ?? 'Failed to save policy')
  return result.data
}

export async function effectivePolicyFor(orgId: string, platform: AdsPlatform, adAccountId: string): Promise<EffectivePolicy> {
  const rows = await listPolicyRows(orgId)
  return rows.length ? mergePolicies(rows as unknown as PolicyRow[], platform, adAccountId) : defaultPolicy()
}
