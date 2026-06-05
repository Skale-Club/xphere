import { redirect } from 'next/navigation'

import { getAgents } from './actions'
import { listAgentGroups } from './_actions/groups'
import { getUser } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { AgentsSubNav } from '@/components/agents/agents-sub-nav'

export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  const [agents, groupsRes] = await Promise.all([getAgents(), listAgentGroups()])
  const groups = groupsRes.ok ? groupsRes.data : []

  return (
    // No `autoCollapseBasePath` on purpose: the tree must stay visible on
    // /agents/[id]/* so the user can switch agents and sub-pages.
    <SubSidebarLayout
      storageKey="sub-sidebar:agents"
      title="Agents"
      nav={<AgentsSubNav agents={agents} groups={groups} />}
    >
      {children}
    </SubSidebarLayout>
  )
}
