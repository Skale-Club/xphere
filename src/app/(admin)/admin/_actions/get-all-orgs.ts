'use server'

import { createServiceRoleClient } from '@/lib/supabase/admin'

export type OrgRow = {
  id: string
  name: string
  slug: string
  created_at: string
  is_active: boolean
  settings: Record<string, unknown>
  members_count: number
  contacts_count: number
  calls_count: number
  conversations_count: number
}

export async function getAllOrgs(): Promise<OrgRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any

  const { data: orgs, error } = await admin
    .from('organizations')
    .select('id, name, slug, created_at, is_active, settings')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to load organizations: ${error.message}`)

  const withMetrics = await Promise.all(
    (orgs as { id: string; name: string; slug: string; created_at: string; is_active: boolean; settings: unknown }[]).map(async (org) => {
      const [members, contacts, calls, conversations] = await Promise.all([
        admin.from('org_members').select('*', { count: 'exact', head: true }).eq('organization_id', org.id),
        admin.from('contacts').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
        admin.from('calls').select('*', { count: 'exact', head: true }).eq('organization_id', org.id),
        admin.from('conversations').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
      ])
      return {
        ...org,
        settings: (org.settings as Record<string, unknown>) ?? {},
        members_count: (members as { count: number | null }).count ?? 0,
        contacts_count: (contacts as { count: number | null }).count ?? 0,
        calls_count: (calls as { count: number | null }).count ?? 0,
        conversations_count: (conversations as { count: number | null }).count ?? 0,
      }
    })
  )

  return withMetrics
}
