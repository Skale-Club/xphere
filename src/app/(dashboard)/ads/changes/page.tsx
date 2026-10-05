import { redirect } from 'next/navigation'
import { orgRedirect } from '@/lib/org/redirect'
import { listChanges } from '@/lib/ads/commands/engine'
import { can } from '@/lib/rbac/server'
import { createClient, getUser } from '@/lib/supabase/server'
import { ChangesView } from './_components/changes-view'

export default async function AdsChangesPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return orgRedirect('/ads')

  const [initialChanges, canAdmin, { data: accountRows }] = await Promise.all([
    listChanges(orgId as string, { status: ['awaiting_approval'], limit: 50 }),
    can('ads.admin'),
    supabase
      .from('ads_connections')
      .select('platform, ad_account_id, ad_account_name')
      .eq('usable', true)
      .order('platform', { ascending: true }),
  ])

  const accounts = (accountRows ?? [])
    .filter((r): r is typeof r & { platform: 'meta' | 'google' | 'google_business' } =>
      r.platform === 'meta' || r.platform === 'google' || r.platform === 'google_business')
    .map((r) => ({
      platform: r.platform,
      adAccountId: r.ad_account_id,
      adAccountName: r.ad_account_name,
    }))

  return <ChangesView initialChanges={initialChanges} canAdmin={canAdmin} accounts={accounts} />
}
