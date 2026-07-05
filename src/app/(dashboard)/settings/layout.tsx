import { redirect } from 'next/navigation'

import { getUser } from '@/lib/supabase/server'
import { redirectIfDemo } from '@/lib/demo/route-guard'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { SettingsSubNav, SettingsSubNavCollapsed } from '@/components/settings/settings-sub-nav'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')
  await redirectIfDemo()

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:settings"
      title="Settings"
      expandedWidth={176}
      nav={<SettingsSubNav />}
      collapsedActions={<SettingsSubNavCollapsed />}
    >
      {children}
    </SubSidebarLayout>
  )
}
