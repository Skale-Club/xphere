import { redirect } from 'next/navigation'

import { getUser } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { ProspectsSubNav } from '@/components/prospects/prospects-sub-nav'

export default async function ProspectsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:prospects"
      title="Prospects"
      nav={<ProspectsSubNav />}
    >
      {children}
    </SubSidebarLayout>
  )
}
