import { redirect } from 'next/navigation'

import { getAgents } from './actions'
import { getUser } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { AgentsSubNav } from '@/components/agents/agents-sub-nav'

export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  const agents = await getAgents()

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:agents"
      title="Agents"
      expandedWidth={280}
      nav={<AgentsSubNav agents={agents} />}
    >
      {children}
    </SubSidebarLayout>
  )
}
