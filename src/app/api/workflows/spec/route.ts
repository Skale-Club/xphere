// SEED-026 Phase A: org-filtered capability spec endpoint.
// Auth-required. Returned JSON is the source of truth for any AI surface
// authoring workflows for this org.

export const runtime = 'nodejs'

import { createClient, getUser } from '@/lib/supabase/server'
import { getWorkflowSpec } from '@/lib/workflows/spec'

export async function GET() {
  try {
    const user = await getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

    const spec = await getWorkflowSpec(orgId as string, supabase)
    return Response.json(spec, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (err) {
    console.error('[workflows/spec] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
