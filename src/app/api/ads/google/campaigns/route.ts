// Legacy dashboard endpoint for Google Ads campaign status and budget.
//
// Kept for the existing campaign table; every write now goes through the Ads
// Command Engine (src/lib/ads/commands/engine.ts), which snapshots the
// campaign, applies the account policy, validates with Google first, writes,
// reads back, and records the change in the ledger and the journey. New
// callers should use POST /api/ads/changes with a typed command instead.

import { NextRequest } from 'next/server'
import { z } from 'zod'

import { dashboardActor } from '@/lib/ads/commands/actors'
import { submitChange } from '@/lib/ads/commands/engine'
import { engineResponse } from '@/lib/ads/commands/http'
import { NumericIdSchema } from '@/lib/ads/validation'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MutateSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    customer_id: NumericIdSchema,
    campaign_id: NumericIdSchema,
    status: z.enum(['ENABLED', 'PAUSED']),
  }),
  z.object({
    action: z.literal('set_budget'),
    customer_id: NumericIdSchema,
    campaign_id: NumericIdSchema,
    /** Ignored: the engine resolves the campaign's budget itself. Accepted for old callers. */
    budget_id: NumericIdSchema.optional(),
    /** Major units of the account currency per day. */
    daily_budget: z.number().positive().optional(),
    /** Legacy name — was always major units of the account currency, never USD. */
    daily_budget_usd: z.number().positive().optional(),
  }),
])

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

export async function POST(request: NextRequest): Promise<Response> {
  const actor = await dashboardActor()
  if (!actor) return err('Unauthorized', 401)
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
          platform: 'google',
          ad_account_id: data.customer_id,
          type: 'google.campaign.set_status',
          campaign_id: data.campaign_id,
          status: data.status,
        },
      }),
    )
  }

  const dailyBudget = data.daily_budget ?? data.daily_budget_usd
  if (dailyBudget == null) return err('Provide daily_budget (major currency units)')

  return engineResponse(
    await submitChange({
      orgId: orgId as string,
      actor,
      command: {
        platform: 'google',
        ad_account_id: data.customer_id,
        type: 'google.campaign.set_daily_budget',
        campaign_id: data.campaign_id,
        daily_budget: dailyBudget,
      },
    }),
  )
}
