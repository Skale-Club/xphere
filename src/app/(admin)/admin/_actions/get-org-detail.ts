'use server'

import { createServiceRoleClient } from '@/lib/supabase/admin'

export type OrgMember = {
  id: string
  user_id: string
  email: string
  role: string
  joined_at: string
}

export type OrgDetail = {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
  settings: Record<string, unknown>
  contacts_count: number
  calls_count: number
  conversations_count: number
  members: OrgMember[]
}

export async function getOrgDetail(orgId: string): Promise<OrgDetail> {
  const admin = createServiceRoleClient()

  const [orgResult, membersResult, contacts, calls, conversations] = await Promise.all([
    admin.from('organizations').select('id, name, slug, is_active, created_at, settings').eq('id', orgId).single(),
    admin.from('org_members').select('id, user_id, role, created_at').eq('organization_id', orgId).order('created_at', { ascending: true }),
    admin.from('contacts').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('calls').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    admin.from('conversations').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
  ])

  if (orgResult.error) throw new Error(`Organization not found: ${orgResult.error.message}`)
  const org = orgResult.data
  const rawMembers = membersResult.data ?? []

  let emailMap = new Map<string, string>()
  if (rawMembers.length > 0) {
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    emailMap = new Map(users.map(u => [u.id, u.email ?? '']))
  }

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    is_active: org.is_active,
    created_at: org.created_at,
    settings: (org.settings as Record<string, unknown>) ?? {},
    contacts_count: contacts.count ?? 0,
    calls_count: calls.count ?? 0,
    conversations_count: conversations.count ?? 0,
    members: rawMembers.map(m => ({
      id: m.id,
      user_id: m.user_id,
      email: emailMap.get(m.user_id) ?? m.user_id,
      role: m.role,
      joined_at: m.created_at,
    })),
  }
}

export async function updateOrgSettings(orgId: string, settings: Record<string, unknown>): Promise<void> {
  const admin = createServiceRoleClient()
  const { error } = await admin
    .from('organizations')
    .update({ settings: settings as import('@/types/database').Json })
    .eq('id', orgId)
  if (error) throw new Error(`Failed to update settings: ${error.message}`)
}
