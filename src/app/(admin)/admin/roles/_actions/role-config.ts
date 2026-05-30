'use server'

import { z } from 'zod'

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  CONFIGURABLE_ROLES,
  buildPermissionRows,
  resolveRoleConfig,
  type ConfigurableRole,
  type OrgRolesConfig,
  type RoleOrgOption,
} from '@/lib/rbac/permissions'

/**
 * Platform-admin gate. The (admin) layout already redirects non-platform users,
 * but role config is sensitive + uses the service role (cross-org writes), so we
 * re-verify here. Service role bypasses per-org owner RLS by design.
 */
async function requirePlatformAdmin() {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated', admin: null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any
  const isEnvAdmin = !!user.email && user.email === process.env.PLATFORM_ADMIN_EMAIL
  const { data: pa } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!isEnvAdmin && !pa) return { error: 'Super admin access required', admin: null }
  return { error: null, admin }
}

export async function listOrgsForRoles(): Promise<{
  error: string | null
  orgs: RoleOrgOption[]
}> {
  const { error, admin } = await requirePlatformAdmin()
  if (error || !admin) return { error, orgs: [] }

  const { data, error: dbErr } = await admin
    .from('organizations')
    .select('id, name, slug')
    .order('name', { ascending: true })

  if (dbErr) return { error: dbErr.message, orgs: [] }
  return { error: null, orgs: (data ?? []) as RoleOrgOption[] }
}

export async function getRoleConfig(orgId: string): Promise<{
  error: string | null
  config: OrgRolesConfig | null
}> {
  const { error, admin } = await requirePlatformAdmin()
  if (error || !admin) return { error, config: null }

  const { data: perms } = await admin
    .from('role_permissions')
    .select('role, permission_key, enabled')
    .eq('organization_id', orgId)
  const { data: settings } = await admin
    .from('role_settings')
    .select('role, restrict_to_assigned')
    .eq('organization_id', orgId)

  const config = {} as OrgRolesConfig
  for (const role of CONFIGURABLE_ROLES) {
    const rows = ((perms ?? []) as { role: string; permission_key: string; enabled: boolean }[])
      .filter((p) => p.role === role)
      .map((p) => ({ permission_key: p.permission_key, enabled: p.enabled }))
    const setting = ((settings ?? []) as { role: string; restrict_to_assigned: boolean }[]).find(
      (s) => s.role === role,
    )
    config[role] = resolveRoleConfig(role, rows, setting?.restrict_to_assigned ?? false)
  }
  return { error: null, config }
}

const saveSchema = z.object({
  orgId: z.string().uuid(),
  role: z.enum(['admin', 'member']),
  permissions: z.record(z.string(), z.boolean()),
  restrictToAssigned: z.boolean(),
})

export async function saveRoleConfig(input: {
  orgId: string
  role: ConfigurableRole
  permissions: Record<string, boolean>
  restrictToAssigned: boolean
}): Promise<{ error: string | null }> {
  const { error, admin } = await requirePlatformAdmin()
  if (error || !admin) return { error }

  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }
  const { orgId, role, permissions, restrictToAssigned } = parsed.data

  const now = new Date().toISOString()
  const rows = buildPermissionRows(role, permissions).map((r) => ({
    organization_id: orgId,
    ...r,
    updated_at: now,
  }))
  const { error: upErr } = await admin
    .from('role_permissions')
    .upsert(rows, { onConflict: 'organization_id,role,permission_key' })
  if (upErr) return { error: upErr.message }

  const { error: setErr } = await admin
    .from('role_settings')
    .upsert(
      { organization_id: orgId, role, restrict_to_assigned: restrictToAssigned, updated_at: now },
      { onConflict: 'organization_id,role' },
    )
  if (setErr) return { error: setErr.message }

  return { error: null }
}
