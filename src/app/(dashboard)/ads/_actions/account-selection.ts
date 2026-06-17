'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'

export type AdObjective = 'leads' | 'sales'

export type ManagedAdAccount = {
  ad_account_id: string
  ad_account_name: string | null
  status: string
}

type Platform = 'meta' | 'google'

async function adminClient() {
  const user = await getUser()
  if (!user) {
    throw new Error('Forbidden')
  }
  return createClient()
}

/** All connected accounts for a platform in the active org (active + available). */
export async function listManagedAdAccounts(platform: Platform): Promise<ManagedAdAccount[]> {
  const supabase = await adminClient()
  const { data } = await supabase
    .from('ads_connections')
    .select('ad_account_id, ad_account_name, status')
    .eq('platform', platform)
    .order('ad_account_name', { ascending: true })
  return (data ?? []) as ManagedAdAccount[]
}

/**
 * Set which accounts are shown for this org. Selected → 'active', the rest →
 * 'available' (still connected, just hidden). RLS scopes the writes to the org.
 */
export async function setActiveAdAccounts(
  platform: Platform,
  activeIds: string[],
): Promise<{ error?: string }> {
  const supabase = await adminClient()

  const { error: e1 } = await supabase
    .from('ads_connections')
    .update({ status: 'available' })
    .eq('platform', platform)
  if (e1) return { error: e1.message }

  if (activeIds.length > 0) {
    const { error: e2 } = await supabase
      .from('ads_connections')
      .update({ status: 'active' })
      .eq('platform', platform)
      .in('ad_account_id', activeIds)
    if (e2) return { error: e2.message }
  }

  // Bust the server cache so router.refresh() re-renders with the new active set.
  revalidatePath('/ads')
  revalidatePath('/ads/google')

  return {}
}

/** Set the campaign objective for a specific ad account connection (scoped by RLS). */
export async function setAdAccountObjective(
  adAccountId: string,
  platform: Platform,
  objective: AdObjective,
): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('ads_connections')
    .update({ ad_objective: objective })
    .eq('platform', platform)
    .eq('ad_account_id', adAccountId)
  revalidatePath('/ads')
  revalidatePath('/ads/google')
}
