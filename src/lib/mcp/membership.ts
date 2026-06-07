// Membership validation for MCP per-user multi-org access.
//
// The MCP server uses the service-role client (bypasses RLS) so org safety
// CANNOT rely on RLS — this in-code check is the only guard preventing a
// user from acting on an org they don't belong to.

import { createServiceRoleClient } from '@/lib/supabase/admin'

/**
 * Returns true only when a (userId, orgId) row exists in org_members.
 * Uses the service-role client because the caller context has no auth.uid().
 */
export async function assertUserInOrg(userId: string, orgId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data } = await supabase
    .from('org_members')
    .select('id')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return data !== null
}
