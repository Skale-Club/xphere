import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GoogleAdsConnect } from '../_components/google-ads-connect'
import { GoogleAdsOverview } from '../_components/google-ads-overview'

export default async function GoogleAdsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: connections } = await supabase
    .from('ads_connections')
    .select('id, ad_account_id, ad_account_name, status, created_at')
    .eq('platform', 'google')
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (!connections?.length) {
    return <GoogleAdsConnect />
  }

  const primary = connections[0]
  return (
    <GoogleAdsOverview
      customerId={primary.ad_account_id}
      customerName={primary.ad_account_name ?? primary.ad_account_id}
      connections={connections.map((c) => ({ id: c.ad_account_id, name: c.ad_account_name ?? c.ad_account_id }))}
    />
  )
}
