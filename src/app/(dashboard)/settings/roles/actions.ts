'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import {
  CONFIGURABLE_ROLES,
  buildPermissionRows,
  resolveRoleConfig,
  type ConfigurableRole,
  type OrgRolesConfig,
} from '@/lib/rbac/permissions'

/** Owner-only gate for the current active org. */
async function requireOwner() {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated', orgId: null as string | null }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization', orgId: null }

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId as string)
    .maybeSingle()

  if (membership?.role !== 'owner') {
    return { error: 'Owner access required', orgId: null }
  }
  return { error: null, orgId: orgId as string }
}

export async function getOwnRolesConfig(): Promise<{
  error: string | null
  config: OrgRolesConfig | null
}> {
  const { error, orgId } = await requireOwner()
  if (error || !orgId) return { error, config: null }

  const supabase = await createClient()
  const { data: perms } = await supabase
    .from('role_permissions')
    .select('role, permission_key, enabled')
    .eq('organization_id', orgId)
  const { data: settings } = await supabase
    .from('role_settings')
    .select('role, restrict_to_assigned')
    .eq('organization_id', orgId)

  const config = {} as OrgRolesConfig
  for (const role of CONFIGURABLE_ROLES) {
    const rows = (perms ?? [])
      .filter((p) => p.role === role)
      .map((p) => ({ permission_key: p.permission_key as string, enabled: p.enabled as boolean }))
    const setting = (settings ?? []).find((s) => s.role === role)
    config[role] = resolveRoleConfig(role, rows, (setting?.restrict_to_assigned as boolean) ?? false)
  }
  return { error: null, config }
}

const saveSchema = z.object({
  role: z.enum(['admin', 'member']),
  permissions: z.record(z.string(), z.boolean()),
  restrictToAssigned: z.boolean(),
})

export async function saveOwnRoleConfig(input: {
  role: ConfigurableRole
  permissions: Record<string, boolean>
  restrictToAssigned: boolean
}): Promise<{ error: string | null }> {
  const { error, orgId } = await requireOwner()
  if (error || !orgId) return { error }

  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }
  const { role, permissions, restrictToAssigned } = parsed.data

  const supabase = await createClient()
  const now = new Date().toISOString()

  const rows = buildPermissionRows(role, permissions).map((r) => ({
    organization_id: orgId,
    ...r,
    updated_at: now,
  }))
  const { error: upErr } = await supabase
    .from('role_permissions')
    .upsert(rows, { onConflict: 'organization_id,role,permission_key' })
  if (upErr) return { error: upErr.message }

  const { error: setErr } = await supabase
    .from('role_settings')
    .upsert(
      { organization_id: orgId, role, restrict_to_assigned: restrictToAssigned, updated_at: now },
      { onConflict: 'organization_id,role' },
    )
  if (setErr) return { error: setErr.message }

  revalidatePath('/settings/roles')
  return { error: null }
}
