import { PageContainer } from '@/components/layout/page-header'
import { getRoutingChain } from './actions'
import { listOrgMembersForSelect } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { RoutingChainEditor } from '@/components/calls/routing-chain-editor'

export const metadata = { title: 'Roteamento de chamadas' }

export default async function SettingsCallsPage() {
  const [chain, members] = await Promise.all([
    getRoutingChain(),
    listOrgMembersForSelect(),
  ])

  return (
    <PageContainer>
      <RoutingChainEditor initial={chain} members={members} />
    </PageContainer>
  )
}
