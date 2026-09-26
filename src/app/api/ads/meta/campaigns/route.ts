// Legacy dashboard endpoint for Meta campaign status and daily budget.
//
// Kept for the existing campaign tables; every write now goes through the Ads
// Command Engine (src/lib/ads/commands/engine.ts) — snapshot, account policy,
// Meta validate_only, write, read-back, ledger and journey. New callers should
// use POST /api/ads/changes with a typed command instead.

import { NextRequest } from 'next/server'
import { z } from 'zod'

import { dashboardActor } from '@/lib/ads/commands/actors'
import { submitChange } from '@/lib/ads/commands/engine'
import { engineResponse } from '@/lib/ads/commands/http'
import { MetaAdAccountIdSchema, MetaObjectIdSchema } from '@/lib/ads/validation'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MutateSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    campaign_id: MetaObjectIdSchema,
    ad_account_id: MetaAdAccountIdSchema,
    status: z.enum(['ACTIVE', 'PAUSED']),
  }),
  z.object({
    action: z.literal('set_daily_budget'),
    campaign_id: MetaObjectIdSchema,
    ad_account_id: MetaAdAccountIdSchema,
    /** Major currency units (e.g. 50 = R$50/day on a BRL account). */
    daily_budget: z.number().positive().optional(),
    /** Legacy: hundredths of the major unit, as older dashboard builds sent it. */
    daily_budget_cents: z.number().int().positive().optional(),
  }),
])

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

export async function POST(request: NextRequest): Promise<Response> {
  const actor = await dashboardActor()
  if (!actor) return err('Unauthorized', 401)
  // Reading ad performance and *changing* it are different privileges.
  if (!actor.canManage) return err('You do not have permission to manage ads.', 403)

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

  const parsed = MutateSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid request')
  const data = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  if (data.action === 'set_status') {
    return engineResponse(
      await submitChange({
        orgId: orgId as string,
        actor,
        command: {
          platform: 'meta',
          ad_account_id: data.ad_account_id,
          type: 'meta.campaign.set_status',
          campaign_id: data.campaign_id,
          status: data.status,
        },
      }),
    )
  }

  const dailyBudget = data.daily_budget ?? (data.daily_budget_cents != null ? data.daily_budget_cents / 100 : undefined)
  if (dailyBudget == null) return err('Provide daily_budget (major currency units) or daily_budget_cents')

  return engineResponse(
    await submitChange({
      orgId: orgId as string,
      actor,
      command: {
        platform: 'meta',
        ad_account_id: data.ad_account_id,
        type: 'meta.campaign.set_daily_budget',
        campaign_id: data.campaign_id,
        daily_budget: dailyBudget,
      },
    }),
  )
}
