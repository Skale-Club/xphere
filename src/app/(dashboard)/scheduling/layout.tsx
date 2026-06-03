import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { SchedulingSubNav } from '@/components/scheduling/scheduling-sub-nav'

export default async function SchedulingLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:scheduling"
      title="Scheduling"
nav={<SchedulingSubNav />}
    >
      {children}
    </SubSidebarLayout>
  )
}
