import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { decrypt } from '@/lib/crypto'
import { buildMetaSnapshot } from '@/lib/ads/snapshot'
import { AdsAiChat } from '../_components/ads-ai-chat'

export default async function AdsChatPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: connections } = await supabase
    .from('ads_connections')
    .select('ad_account_id, ad_account_name, encrypted_access_token')
    .eq('platform', 'meta')
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (!connections?.length) redirect('/ads')

  const primary = connections[0]

  // Fetch account snapshot in parallel — best-effort, never blocks the page
  const snapshot = await buildMetaSnapshot(
    primary.ad_account_id,
    await decrypt(primary.encrypted_access_token).catch(() => ''),
  ).catch(() => '')

  return (
    <AdsAiChat
      adAccountId={primary.ad_account_id}
      adAccountName={primary.ad_account_name ?? primary.ad_account_id}
      connections={connections.map((c) => ({ id: c.ad_account_id, name: c.ad_account_name ?? c.ad_account_id }))}
      accountSnapshot={snapshot}
    />
  )
}
