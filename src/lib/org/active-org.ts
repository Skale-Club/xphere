import 'server-only'
import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Single source of truth for the active org, resolved from the DB via
 * `get_current_org_id()` — the SAME resolver RLS uses to scope every query.
 *
 * The `vo_active_org` cookie is only a best-effort cache and CAN drift from the
 * DB (e.g. switching on another device, or a half-completed refresh). Trusting
 * the cookie for display caused a split-brain: topbar/theme from one org, data
 * (RLS) from another. Reading the org here from the DB guarantees the UI always
 * matches the data scope.
 *
 * Cached per-request via React `cache()` (same pattern as getUser /
 * getOrgSettings) so layout, topbar and branding share one round-trip.
 */
export const getActiveOrg = cache(async (): Promise<{ id: string; name: string } | null> => {
  try {
    const supabase = await createClient()
    let { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) {
      // A null here for a signed-in user almost always means the call went out
      // without their token (Supabase Auth briefly failing to refresh an
      // expiring session falls back to the anon key). One short retry rides out
      // most of those blips; <OrgTabSync> reloads the tab if it persists.
      await new Promise((resolve) => setTimeout(resolve, 300))
      ;({ data: orgId } = await supabase.rpc('get_current_org_id'))
    }
    if (!orgId) return null
    const { data: org } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', orgId as string)
      .maybeSingle()
    return org ? { id: org.id, name: org.name } : null
  } catch {
    return null
  }
})
