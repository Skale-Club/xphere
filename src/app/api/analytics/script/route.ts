export const runtime = 'nodejs'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { buildScript } from '@/lib/analytics/tracking-script'

const INGEST_URL = 'https://xphere.app/api/analytics/ingest'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('t')

  if (!token) {
    return new Response('// invalid token', { status: 400, headers: { 'Content-Type': 'application/javascript' } })
  }

  // Validate the token exists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data } = await supabase
    .from('analytics_setups')
    .select('organization_id')
    .eq('script_token', token)
    .maybeSingle()

  if (!data) {
    return new Response('// invalid token', { status: 404, headers: { 'Content-Type': 'application/javascript' } })
  }

  // Resolve the org's Meta Pixel so the script can fire browser-side conversions
  // that dedup against the server-side CAPI events (shared eventID). Only inject
  // when CAPI + browser Pixel are both enabled and a pixel id is configured.
  let pixelId: string | null = null
  const { data: capi } = await supabase
    .from('meta_capi_config')
    .select('pixel_id, browser_pixel_enabled, enabled')
    .eq('org_id', data.organization_id)
    .maybeSingle()
  if (capi?.enabled && capi?.browser_pixel_enabled && capi?.pixel_id) {
    pixelId = capi.pixel_id as string
  }

  const script = buildScript(token, INGEST_URL, pixelId)

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
