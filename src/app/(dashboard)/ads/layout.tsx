import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { AdsPlatformSwitcher } from './_components/ads-platform-switcher'
import { AdsShell } from './_components/ads-shell'

export default async function AdsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  // Beta: only PLATFORM_ADMIN can access the Ads module
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    redirect('/dashboard')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 border-b border-border-subtle px-6 py-3 bg-bg-secondary shrink-0">
        <AdsPlatformSwitcher />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <AdsShell>{children}</AdsShell>
      </div>
    </div>
  )
}
