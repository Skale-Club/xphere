import { redirect } from 'next/navigation'

import { getUser } from '@/lib/supabase/server'
import { SettingsNav } from '@/components/settings/settings-nav'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  const isPlatformAdmin = user.email === process.env.PLATFORM_ADMIN_EMAIL

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="lg:w-56 shrink-0">
          <SettingsNav isPlatformAdmin={isPlatformAdmin} />
        </aside>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}
