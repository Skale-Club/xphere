import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MetaAdsConnect } from './_components/meta-ads-connect'
import { MetaAdsOverview } from './_components/meta-ads-overview'
import { NoAccountsSelected } from './_components/no-accounts-selected'

export default async function AdsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()

  // All connected accounts (active = shown, available = connected-but-hidden).
  const { data: rows } = await supabase
    .from('ads_connections')
    .select('id, ad_account_id, ad_account_name, status, created_at')
    .eq('platform', 'meta')
    .order('created_at', { ascending: true })

  const all = rows ?? []
  if (all.length === 0) {
    return <MetaAdsConnect />
  }

  const connections = all.filter((c) => c.status === 'active')

  // Connected, but the admin hasn't picked which accounts to show yet.
  if (connections.length === 0) {
    return <NoAccountsSelected platform="meta" />
  }

  const primaryAccount = connections[0]

  return (
    <div>
      <MetaAdsOverview
        adAccountId={primaryAccount.ad_account_id}
        adAccountName={primaryAccount.ad_account_name ?? primaryAccount.ad_account_id}
        connections={connections.map((c) => ({ id: c.ad_account_id, name: c.ad_account_name ?? c.ad_account_id }))}
      />
    </div>
  )
}
