import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decidePermission } from './decide'
import type { OrgRole } from './permissions'

/**
 * `can()` for callers without a cookie session — MCP tools, workflow actions —
 * where the user and org come from a token instead. Same decision as `can()`
 * (see decidePermission), resolved with the service-role client. Platform
 * admins are recognised through the platform_admins table only (the
 * PLATFORM_ADMIN_EMAIL bootstrap needs the session's email). Fails closed.
 */
export async function userCanInOrg(userId: string | null, orgId: string, permissionKey: string): Promise<boolean> {
  if (!userId) return false
  try {
    const sb = createServiceRoleClient()
    const [{ data: admin }, { data: member }, { data: grants, error }] = await Promise.all([
      sb.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
      sb.from('org_members').select('role').eq('user_id', userId).eq('organization_id', orgId).maybeSingle(),
      sb.from('role_permissions').select('permission_key, enabled, role').eq('organization_id', orgId),
    ])
    return decidePermission({
      role: ((member as { role?: string } | null)?.role as OrgRole) ?? null,
      isPlatformAdmin: !!admin,
      hasOrg: true,
      grants: error ? null : ((grants ?? []) as Array<{ permission_key: string; enabled: boolean; role: string }>),
      permissionKey,
    })
  } catch {
    return false
  }
}
