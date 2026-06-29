export const runtime = 'nodejs'

import { createClient, getUser } from '@/lib/supabase/server'
import { verifyTrackingInstallation, type VerificationResult } from '@/lib/analytics/verify'

export async function POST(request: Request) {
  try {
    const user = await getUser()
    if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) return Response.json({ ok: false, error: 'No active org' }, { status: 400 })

    const body = await request.json() as { url?: string }
    const url = body.url?.trim()
    if (!url) return Response.json({ ok: false, error: 'url required' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { data: setup } = await sb
      .from('analytics_setups')
      .select('script_token')
      .eq('organization_id', orgId)
      .maybeSingle()

    if (!setup) return Response.json({ ok: false, error: 'No setup found' }, { status: 404 })

    // Primary signal: have we actually received tracking data for this org?
    // This is the only reliable check for scripts injected at runtime by Google
    // Tag Manager or single-page apps — those never appear in the server-rendered
    // HTML, so an HTML scrape would report a false "not found" for a correct install.
    const { count } = await sb
      .from('analytics_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)

    let result: VerificationResult
    if ((count ?? 0) > 0) {
      result = 'verified'
    } else {
      // Fallback: best-effort scrape of the server-rendered HTML. Catches manual
      // installs in static/SSR markup before the first visit; a miss here does NOT
      // mean the script is absent (GTM/SPA inject it client-side).
      result = await verifyTrackingInstallation(url, setup.script_token as string)
    }

    const verified = result === 'verified'
    const installed = verified || result === 'no_events_yet'

    // Persist state. 'verified' = data flowing; 'no_events_yet' = detected in HTML,
    // awaiting first visit; otherwise keep the user on the verify step ('pending').
    await sb
      .from('analytics_setups')
      .update({
        verification_state: verified ? 'verified' : installed ? 'no_events_yet' : 'pending',
        primary_website_url: url,
        ...(installed ? { verified_at: new Date().toISOString() } : {}),
      })
      .eq('organization_id', orgId)

    return Response.json({ ok: true, result })
  } catch {
    return Response.json({ ok: true, result: 'failed' })
  }
}
