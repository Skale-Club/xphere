import { Suspense } from 'react'
import { UsersRound } from 'lucide-react'

import { listMembers, listInvites, inviteMember, revokeInvite, removeMember, PER_PAGE } from './actions'
import { MembersClient } from './members-client'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function MembersPage({ searchParams }: Props) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)

  const [{ members, total }, { invites }] = await Promise.all([
    listMembers(page),
    listInvites(),
  ])

  return (
    <PageContainer>
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
          total={total}
          page={page}
          perPage={PER_PAGE}
          inviteMember={inviteMember}
          revokeInvite={revokeInvite}
          removeMember={removeMember}
        />
      </Suspense>
    </PageContainer>
  )
}
