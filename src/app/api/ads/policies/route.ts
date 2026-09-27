// Ads account policies (guardrails for the command engine).
//
//   GET /api/ads/policies                       all scopes for the org + defaults
//   GET /api/ads/policies?platform=&ad_account_id=   + the effective merged policy
//   PUT /api/ads/policies { platform, ad_account_id, ...fields }   (ads.admin)

import { NextRequest } from 'next/server'

import { defaultPolicy } from '@/lib/ads/commands/policies'
import { effectivePolicyFor, listPolicyRows, PolicyInputSchema, upsertPolicy } from '@/lib/ads/commands/policy-store'
import { can } from '@/lib/rbac/server'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

async function currentOrg(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_current_org_id')
  return (data as string | null) ?? null
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await can('ads.view'))) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = await currentOrg()
  if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

  const platform = request.nextUrl.searchParams.get('platform')
  const adAccountId = request.nextUrl.searchParams.get('ad_account_id')
  const policies = await listPolicyRows(orgId)
  const effective =
    (platform === 'meta' || platform === 'google') && adAccountId
      ? await effectivePolicyFor(orgId, platform, adAccountId)
      : undefined

  return Response.json({ policies, defaults: defaultPolicy(), effective })
}

export async function PUT(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await can('ads.admin'))) {
    return Response.json({ error: 'Managing ad account policies requires the ads.admin permission.' }, { status: 403 })
  }
  const orgId = await currentOrg()
  if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

  let raw: unknown
  try { raw = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = PolicyInputSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid policy' }, { status: 400 })

  const policy = await upsertPolicy(orgId, parsed.data, user.id)
  return Response.json({ policy })
}
