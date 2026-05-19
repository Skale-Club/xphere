'use server'

import { createServiceRoleClient } from '@/lib/supabase/admin'

export type PlatformStats = {
  total_orgs: number
  active_orgs: number
  total_contacts: number
  total_calls: number
  total_conversations: number
  total_members: number
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const admin = createServiceRoleClient()

  const [orgs, contacts, calls, conversations, members] = await Promise.all([
    admin.from('organizations').select('is_active', { count: 'exact' }),
    admin.from('contacts').select('*', { count: 'exact', head: true }),
    admin.from('calls').select('*', { count: 'exact', head: true }),
    admin.from('conversations').select('*', { count: 'exact', head: true }),
    admin.from('org_members').select('*', { count: 'exact', head: true }),
  ])

  const activeOrgs = (orgs.data ?? []).filter(o => o.is_active).length

  return {
    total_orgs: orgs.count ?? 0,
    active_orgs: activeOrgs,
    total_contacts: contacts.count ?? 0,
    total_calls: calls.count ?? 0,
    total_conversations: conversations.count ?? 0,
    total_members: members.count ?? 0,
  }
}

export async function bulkApplyFeatureFlag(flagKey: string, enabled: boolean): Promise<{ updated: number }> {
  const admin = createServiceRoleClient()

  const { data: orgs, error } = await admin
    .from('organizations')
    .select('id, settings')

  if (error) throw new Error(`Failed to load orgs: ${error.message}`)

  await Promise.all(
    orgs.map(org => {
      const current = (org.settings as Record<string, unknown>) ?? {}
      return admin
        .from('organizations')
        .update({ settings: { ...current, [flagKey]: enabled } as import('@/types/database').Json })
        .eq('id', org.id)
    })
  )

  return { updated: orgs.length }
}
