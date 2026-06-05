'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import {
  CONFIGURABLE_ROLES,
  ALL_PERMISSION_KEYS,
  buildPermissionRows,
  resolveRoleConfig,
  type ConfigurableRole,
  type OrgRolesConfig,
} from '@/lib/rbac/permissions'

// ── shared ──────────────────────────────────────────────────────────────────

async function requireAdminOrOwner() {
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

  if (!['admin', 'owner'].includes(membership?.role ?? '')) {
    return { error: 'Admin access required', orgId: null }
  }
  return { error: null, orgId: orgId as string }
}

// ── built-in roles config ────────────────────────────────────────────────────

export async function getRolesConfig(): Promise<{
  error: string | null
  config: OrgRolesConfig | null
}> {
  const { error, orgId } = await requireAdminOrOwner()
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

const saveBuiltinSchema = z.object({
  role: z.enum(['admin', 'member']),
  permissions: z.record(z.string(), z.boolean()),
  restrictToAssigned: z.boolean(),
})

export async function saveBuiltinRoleConfig(input: {
  role: ConfigurableRole
  permissions: Record<string, boolean>
  restrictToAssigned: boolean
}): Promise<{ error: string | null }> {
  const { error, orgId } = await requireAdminOrOwner()
  if (error || !orgId) return { error }

  const parsed = saveBuiltinSchema.safeParse(input)
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

  revalidatePath('/settings/members')
  revalidatePath('/settings/roles')
  return { error: null }
}

// ── custom roles ─────────────────────────────────────────────────────────────

export type CustomRole = {
  id: string
  name: string
  description: string | null
  permissions: Record<string, boolean>
  created_at: string
}

export async function listCustomRoles(): Promise<{ roles: CustomRole[]; error: string | null }> {
  const user = await getUser()
  if (!user) return { roles: [], error: 'Not authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { roles: [], error: 'No active organization' }

  const { data, error: dbErr } = await supabase
    .from('org_custom_roles')
    .select('id, name, description, created_at, custom_role_permissions(permission_key, enabled)')
    .eq('organization_id', orgId as string)
    .order('created_at', { ascending: true })

  if (dbErr) return { roles: [], error: dbErr.message }

  const roles: CustomRole[] = (data ?? []).map((r) => {
    const permissions: Record<string, boolean> = {}
    for (const p of (r.custom_role_permissions as { permission_key: string; enabled: boolean }[] ?? [])) {
      permissions[p.permission_key] = p.enabled
    }
    return { id: r.id, name: r.name, description: r.description, permissions, created_at: r.created_at }
  })

  return { roles, error: null }
}

const customRoleSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  permissions: z.record(z.string(), z.boolean()),
})

export async function createCustomRole(input: {
  name: string
  description?: string
  permissions: Record<string, boolean>
}): Promise<{ id: string | null; error: string | null }> {
  const { error, orgId } = await requireAdminOrOwner()
  if (error || !orgId) return { id: null, error }

  const parsed = customRoleSchema.safeParse(input)
  if (!parsed.success) return { id: null, error: 'Invalid input' }
  const { name, description, permissions } = parsed.data

  const supabase = await createClient()

  const { data: role, error: insertErr } = await supabase
    .from('org_custom_roles')
    .insert({ organization_id: orgId, name: name.trim(), description: description?.trim() || null })
    .select('id')
    .single()

  if (insertErr) {
    if (insertErr.code === '23505') return { id: null, error: `A role named "${name}" already exists.` }
    return { id: null, error: insertErr.message }
  }

  const permRows = ALL_PERMISSION_KEYS.map((key) => ({
    custom_role_id: role.id,
    permission_key: key,
    enabled: permissions[key] ?? false,
    updated_at: new Date().toISOString(),
  }))

  const { error: permErr } = await supabase
    .from('custom_role_permissions')
    .insert(permRows)

  if (permErr) return { id: null, error: permErr.message }

  revalidatePath('/settings/members')
  return { id: role.id, error: null }
}

export async function updateCustomRole(
  id: string,
  input: { name: string; description?: string; permissions: Record<string, boolean> },
): Promise<{ error: string | null }> {
  const { error, orgId } = await requireAdminOrOwner()
  if (error || !orgId) return { error }

  const parsed = customRoleSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }
  const { name, description, permissions } = parsed.data

  const supabase = await createClient()
  const now = new Date().toISOString()

  const { error: updErr } = await supabase
    .from('org_custom_roles')
    .update({ name: name.trim(), description: description?.trim() || null, updated_at: now })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (updErr) {
    if (updErr.code === '23505') return { error: `A role named "${name}" already exists.` }
    return { error: updErr.message }
  }

  const permRows = ALL_PERMISSION_KEYS.map((key) => ({
    custom_role_id: id,
    permission_key: key,
    enabled: permissions[key] ?? false,
    updated_at: now,
  }))

  const { error: permErr } = await supabase
    .from('custom_role_permissions')
    .upsert(permRows, { onConflict: 'custom_role_id,permission_key' })

  if (permErr) return { error: permErr.message }

  revalidatePath('/settings/members')
  return { error: null }
}

export async function deleteCustomRole(id: string): Promise<{ error: string | null }> {
  const { error, orgId } = await requireAdminOrOwner()
  if (error || !orgId) return { error }

  const supabase = await createClient()
  const { error: delErr } = await supabase
    .from('org_custom_roles')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (delErr) return { error: delErr.message }

  revalidatePath('/settings/members')
  return { error: null }
}
