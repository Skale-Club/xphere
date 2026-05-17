import { Suspense } from 'react'
import { UsersRound } from 'lucide-react'

import { listMembers, listInvites, inviteMember, revokeInvite, removeMember } from './actions'
import { MembersClient } from './members-client'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export const dynamic = 'force-dynamic'

export default async function MembersPage() {
  const [{ members }, { invites }] = await Promise.all([
    listMembers(),
    listInvites(),
  ])

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Team"
        eyebrowIcon={UsersRound}
        title="Members"
        description="Manage team members and invitations for this organization."
      />
      <Suspense fallback={null}>
        <MembersClient
          members={members}
          invites={invites}
          inviteMember={inviteMember}
          revokeInvite={revokeInvite}
          removeMember={removeMember}
        />
      </Suspense>
    </PageContainer>
  )
}
