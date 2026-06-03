'use server'

import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import {
  getDashboardMetrics,
  getSessionsOverTime,
  getTrafficSources,
  getUTMCampaigns,
  getTopPages,
  getTopLandingPages,
  getGeoBreakdown,
  getDeviceBreakdown,
  getRecentSessions,
  getPrevRange,
} from '@/lib/traffic/queries'
import type { DateRange } from '@/lib/traffic/types'

async function getOrgAndClient() {
  const user = await getUser()
  if (!user) redirect('/')
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) redirect('/organizations')
  return { supabase, orgId: orgId as string, user }
}

export async function getOrCreateTrafficSetup() {
  const { supabase, orgId } = await getOrgAndClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  let { data: setup } = await sb
    .from('traffic_setups')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!setup) {
    const { data: created } = await sb
      .from('traffic_setups')
      .insert({ organization_id: orgId })
      .select('*')
      .single()
    setup = created
  }

  return setup as {
    id: string
    organization_id: string
    script_token: string
    primary_website_url: string | null
    verification_state: 'not_started' | 'pending' | 'verified' | 'failed' | 'no_events_yet'
    verified_at: string | null
    gtm_container_id: string | null
  } | null
}

export async function saveTrafficSetup(formData: FormData) {
  const { supabase, orgId } = await getOrgAndClient()
  const url = (formData.get('website_url') as string)?.trim() || null
  const gtm = (formData.get('gtm_container_id') as string)?.trim() || null

  // Persist the URL/GTM ID without touching verification_state — the verify
  // endpoint and the ingest pipeline own that transition. Resetting it here would
  // bounce the user out of the wizard's verify step on every save.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('traffic_setups')
    .update({
      primary_website_url: url,
      gtm_container_id: gtm,
    })
    .eq('organization_id', orgId)
}

export async function getDashboardData(from: string, to: string) {
  const { supabase, orgId } = await getOrgAndClient()

  const range: DateRange = {
    from: new Date(from),
    to: new Date(to),
  }
  const prev = getPrevRange(range)

  const [metrics, timeSeries, sources, campaigns, topPages, landingPages, geo, devices, recent] =
    await Promise.all([
      getDashboardMetrics(supabase, orgId, range, prev),
      getSessionsOverTime(supabase, orgId, range),
      getTrafficSources(supabase, orgId, range),
      getUTMCampaigns(supabase, orgId, range),
      getTopPages(supabase, orgId, range),
      getTopLandingPages(supabase, orgId, range),
      getGeoBreakdown(supabase, orgId, range),
      getDeviceBreakdown(supabase, orgId, range),
      getRecentSessions(supabase, orgId, 20),
    ])

  return { metrics, timeSeries, sources, campaigns, topPages, landingPages, geo, devices, recent }
}
