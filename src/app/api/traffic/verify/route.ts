export const runtime = 'nodejs'

import { createClient, getUser } from '@/lib/supabase/server'
import { verifyTrackingInstallation } from '@/lib/traffic/verify'

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
    const { data: setup } = await (supabase as any)
      .from('traffic_setups')
      .select('script_token')
      .eq('organization_id', orgId)
      .maybeSingle()

    if (!setup) return Response.json({ ok: false, error: 'No setup found' }, { status: 404 })

    const result = await verifyTrackingInstallation(url, setup.script_token as string)

    // Update verification state in DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('traffic_setups')
      .update({
        verification_state: result === 'verified' || result === 'no_events_yet' ? result : 'failed',
        primary_website_url: url,
        ...(result === 'verified' || result === 'no_events_yet' ? { verified_at: new Date().toISOString() } : {}),
      })
      .eq('organization_id', orgId)

    return Response.json({ ok: true, result })
  } catch {
    return Response.json({ ok: true, result: 'failed' })
  }
}
