import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { AdsPlatformSwitcher } from './_components/ads-platform-switcher'
import { AdsShell } from './_components/ads-shell'

export default async function AdsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  // Cheap, indexed count — used for the "Changes" nav badge. RLS scopes it to
  // the active org already, so no explicit org_id filter is needed here.
  const supabase = await createClient()
  const { count } = await supabase
    .from('ads_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'awaiting_approval')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 border-b border-border-subtle px-6 py-3 bg-bg-secondary shrink-0">
        <AdsPlatformSwitcher pendingChangesCount={count ?? 0} />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <AdsShell>{children}</AdsShell>
      </div>
    </div>
  )
}
