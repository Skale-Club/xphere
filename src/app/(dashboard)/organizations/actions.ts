'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { seedOrgWorkflows } from '@/lib/workflows/seed-org'
import { slugify } from '@/lib/slug'

const ORG_COOKIE = 'vo_active_org'
const COOKIE_OPTS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const }

async function setActiveOrgCookie(id: string, name: string) {
  const jar = await cookies()
  jar.set(ORG_COOKIE, JSON.stringify({ id, name }), COOKIE_OPTS)
}

export async function getUserOrgs(): Promise<{ id: string; name: string; logo_url: string | null }[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data } = await supabase
    .from('org_members')
    .select('organization_id, organizations(id, name, logo_url)')
    .eq('user_id', user.id)

  return (data ?? [])
    .map(m => m.organizations as { id: string; name: string; logo_url: string | null } | null)
    .filter((o): o is { id: string; name: string; logo_url: string | null } => o !== null)
}

export async function createOrganization(data: { name: string }): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const admin = createServiceRoleClient()
  const name = data.name.trim()
  const slug = slugify(name)
  if (!name) return { error: 'Organization name is required.' }
  if (!slug) return { error: 'Organization name must include letters or numbers.' }

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name, slug, widget_token: crypto.randomUUID() })
    .select('id')
    .single()
  if (orgError) {
    if (orgError.code === '23505') return { error: 'An organization with this name already exists.' }
    return { error: orgError.message }
  }

  // The creator is the org Owner (top of the RBAC hierarchy; can manage roles).
  const { error: ownerMemberError } = await admin
    .from('org_members')
    .insert({ organization_id: org.id, user_id: user.id, role: 'owner' })
  if (ownerMemberError) {
    // Some environments may lag behind migration 1116, where `owner` was added
    // to public.user_role. Fall back to legacy admin so org creation still works.
    const roleMissing =
      ownerMemberError.code === '22P02' ||
      ownerMemberError.message.toLowerCase().includes('invalid input value for enum')

    if (roleMissing) {
      const { error: adminMemberError } = await admin
        .from('org_members')
        .insert({ organization_id: org.id, user_id: user.id, role: 'admin' })
      if (adminMemberError) {
        await admin.from('organizations').delete().eq('id', org.id)
        return { error: adminMemberError.message }
      }
    } else {
      await admin.from('organizations').delete().eq('id', org.id)
      return { error: ownerMemberError.message }
    }
  }

  const { error: activeOrgError } = await supabase
    .from('user_active_org')
    .upsert({ user_id: user.id, organization_id: org.id, updated_at: new Date().toISOString() })
  if (activeOrgError) return { error: activeOrgError.message }

  await setActiveOrgCookie(org.id, name)
  revalidatePath('/', 'layout')

  // Seed platform-default workflows for the new org (fire-and-forget).
  void seedOrgWorkflows(org.id).catch(() => {})
}

export async function switchOrganization(organizationId: string): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Verify membership and get org name in one query
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', organizationId)
    .single()

  if (!org) return { error: 'You are not a member of this organization.' }

  const { error } = await supabase
    .from('user_active_org')
    .upsert({ user_id: user.id, organization_id: organizationId, updated_at: new Date().toISOString() })

  if (error) return { error: error.message }

  await setActiveOrgCookie(org.id, org.name)
  revalidatePath('/', 'layout')
  return {}
}

export async function updateOrganization(
  id: string,
  data: { name: string; is_active: boolean }
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const slug = slugify(data.name)
  const { error } = await supabase
    .from('organizations')
    .update({ name: data.name, slug, is_active: data.is_active })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/organizations')
}

export async function toggleOrganizationStatus(
  id: string,
  is_active: boolean
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('organizations')
    .update({ is_active })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/organizations')
}
