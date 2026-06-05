import { Suspense } from 'react'
import { UsersRound } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { listMembers, listInvites } from '@/app/(dashboard)/members/actions'
import { getRolesConfig, listCustomRoles } from './actions'
import { MembersSettingsClient } from './members-settings-client'

export const dynamic = 'force-dynamic'

const PER_PAGE = 10

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function MembersSettingsPage({ searchParams }: Props) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)

  const [
    { members, total },
    { invites },
    { config: rolesConfig },
    { roles: customRoles },
  ] = await Promise.all([
    listMembers(page),
    listInvites(),
    getRolesConfig(),
    listCustomRoles(),
  ])

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Workspace"
        eyebrowIcon={UsersRound}
        title="Members"
        description="Manage team members, invitations, and role permissions."
      />
      <Suspense>
        <MembersSettingsClient
          members={members}
          invites={invites as never}
          total={total}
          page={page}
          perPage={PER_PAGE}
          rolesConfig={rolesConfig}
          customRoles={customRoles}
        />
      </Suspense>
    </PageContainer>
  )
}
