import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { CalendarSubNav } from '@/components/calendar/calendar-sub-nav'

export default async function CalendarLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:calendar"
      title="Calendar"
      nav={<CalendarSubNav />}
    >
      {children}
    </SubSidebarLayout>
  )
}
