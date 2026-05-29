import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MetaAdsConnect } from './_components/meta-ads-connect'
import { MetaAdsOverview } from './_components/meta-ads-overview'

export default async function AdsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()

  const { data: connections } = await supabase
    .from('ads_connections')
    .select('id, ad_account_id, ad_account_name, status, created_at')
    .eq('platform', 'meta')
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  const hasConnections = (connections?.length ?? 0) > 0

  if (!hasConnections) {
    return <MetaAdsConnect />
  }

  const primaryAccount = connections![0]

  return (
    <MetaAdsOverview
      adAccountId={primaryAccount.ad_account_id}
      adAccountName={primaryAccount.ad_account_name ?? primaryAccount.ad_account_id}
      connections={connections!.map((c) => ({ id: c.ad_account_id, name: c.ad_account_name ?? c.ad_account_id }))}
    />
  )
}
