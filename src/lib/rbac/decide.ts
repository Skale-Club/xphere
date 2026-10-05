import { DEFAULT_ROLE_PERMISSIONS, type OrgRole } from './permissions'

/**
 * The permission decision behind `can()`, free of any request/session so it
 * can also run where there is no cookie session (MCP, workflows, cron).
 *
 * `grants` is every role_permissions row of the org (null when the read
 * failed). Platform admins and Owners always pass; an org with no stored
 * configuration is unrestricted; a role with no rows of its own falls back to
 * DEFAULT_ROLE_PERMISSIONS.
 */
export function decidePermission(input: {
  role: OrgRole | null
  isPlatformAdmin: boolean
  hasOrg: boolean
  grants: Array<{ permission_key: string; enabled: boolean; role: string }> | null
  permissionKey: string
}): boolean {
  const { role, isPlatformAdmin, hasOrg, grants, permissionKey } = input
  if (isPlatformAdmin) return true
  if (role === 'owner') return true
  if (!hasOrg || (role !== 'admin' && role !== 'member')) return false
  // RBAC not configured for this org yet → no restriction (non-disruptive:
  // enforcement only kicks in once an Owner saves a configuration).
  if (!grants || grants.length === 0) return true
  const roleRows = grants.filter((r) => r.role === role)
  if (roleRows.length === 0) return DEFAULT_ROLE_PERMISSIONS[role].includes(permissionKey)
  return roleRows.find((r) => r.permission_key === permissionKey)?.enabled ?? false
}
