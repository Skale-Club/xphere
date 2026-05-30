import 'server-only'

import { createClient, getUser } from '@/lib/supabase/server'
import {
  DEFAULT_ROLE_PERMISSIONS,
  type OrgRole,
} from './permissions'

/**
 * Server-side RBAC helpers. These mirror the database `has_permission()`
 * function (migration 1116) so the app can gate UI + server actions before the
 * data-layer RLS seal lands. Tenant isolation is still enforced by
 * get_current_org_id() / RLS — these helpers only resolve *feature* permissions.
 */

export interface RbacContext {
  userId: string | null
  orgId: string | null
  role: OrgRole | null
  isPlatformAdmin: boolean
}

/** Resolve the caller's user, active org, org role, and platform-admin status. */
export async function getRbacContext(): Promise<RbacContext> {
  const user = await getUser()
  if (!user) return { userId: null, orgId: null, role: null, isPlatformAdmin: false }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  // Platform admin: env bootstrap OR a row in platform_admins (table may not
  // exist until migration 1116 is applied — treat any error as "not admin").
  const isEnvAdmin = !!user.email && user.email === process.env.PLATFORM_ADMIN_EMAIL
  let isTableAdmin = false
  const { data: pa } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  isTableAdmin = !!pa

  let role: OrgRole | null = null
  if (orgId) {
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', orgId as string)
      .maybeSingle()
    role = (membership?.role as OrgRole) ?? null
  }

  return {
    userId: user.id,
    orgId: (orgId as string) ?? null,
    role,
    isPlatformAdmin: isEnvAdmin || isTableAdmin,
  }
}

/**
 * Does the current user hold `permissionKey` in their active org?
 * Platform admins and Owners always pass; Admin/User resolve against the
 * stored grant matrix, falling back to defaults when the org is uninitialized.
 */
export async function can(permissionKey: string): Promise<boolean> {
  const { userId, orgId, role, isPlatformAdmin } = await getRbacContext()
  if (!userId) return false
  if (isPlatformAdmin) return true
  if (role === 'owner') return true
  if (!orgId || (role !== 'admin' && role !== 'member')) return false

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission_key, enabled, role')
    .eq('organization_id', orgId)

  // RBAC not configured for this org yet → no restriction (non-disruptive:
  // enforcement only kicks in once an Owner saves a configuration).
  if (error || !data || data.length === 0) return true

  const roleRows = data.filter((r) => r.role === role)
  if (roleRows.length === 0) return DEFAULT_ROLE_PERMISSIONS[role].includes(permissionKey)
  return roleRows.find((r) => r.permission_key === permissionKey)?.enabled ?? false
}

/**
 * The permission keys the current user effectively holds, or `null` when the
 * user is unrestricted — a platform admin, an Owner, or any org that has no
 * RBAC configuration yet. UI (e.g. the sidebar) treats `null` as "show all".
 */
export async function getMyPermissions(): Promise<string[] | null> {
  const { userId, orgId, role, isPlatformAdmin } = await getRbacContext()
  if (!userId) return []
  // Unrestricted: platform staff, Owner, or any non-configurable/unknown role
  // (fail open for nav — row-level data is still protected by RLS).
  if (isPlatformAdmin || role === 'owner' || (role !== 'admin' && role !== 'member')) return null
  if (!orgId) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission_key, enabled, role')
    .eq('organization_id', orgId)

  if (error || !data || data.length === 0) return null // RBAC not configured → unrestricted
  const roleRows = data.filter((r) => r.role === role)
  if (roleRows.length === 0) return [...DEFAULT_ROLE_PERMISSIONS[role]]
  return roleRows.filter((r) => r.enabled).map((r) => r.permission_key as string)
}

/** Throwable-style guard for server actions: returns an error string if denied. */
export async function requirePermission(
  permissionKey: string,
): Promise<{ ok: boolean; error: string | null }> {
  return (await can(permissionKey))
    ? { ok: true, error: null }
    : { ok: false, error: 'You do not have permission to do this.' }
}
