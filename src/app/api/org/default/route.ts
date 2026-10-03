import { NextResponse } from 'next/server'

import { isOrgId } from '@/lib/org/request-org'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * POST /api/org/default — make the org of the browser tab the user is looking
 * at their default (`user_active_org`). Called by <OrgTabSync> when a tab gains
 * focus. Requests that carry no org — Realtime's RLS checks, a fresh visit to
 * xphere.app — resolve to this default, so it follows the focused tab while
 * every tab still renders its own org from the URL.
 *
 * Deliberately a route handler, not a server action: setting a cookie inside a
 * server action makes Next.js refresh the current route.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { orgId?: unknown } | null
  const orgId = body?.orgId
  if (!isOrgId(orgId)) return NextResponse.json({ error: 'Invalid orgId' }, { status: 422 })

  const supabase = await createClient()
  // RLS on organizations only shows the caller's own orgs — this is the
  // membership check (same as switchOrganization).
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

  const { error } = await supabase
    .from('user_active_org')
    .upsert({ user_id: user.id, organization_id: org.id, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const response = NextResponse.json({ ok: true })
  response.cookies.set('vo_active_org', JSON.stringify({ id: org.id, name: org.name }), {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  return response
}
