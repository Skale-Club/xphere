import { Suspense } from 'react'
import { listMembers, listInvites, inviteMember, revokeInvite, removeMember } from './actions'
import { MembersClient } from './members-client'

export const dynamic = 'force-dynamic'

export default async function MembersPage() {
  const [{ members }, { invites }] = await Promise.all([
    listMembers(),
    listInvites(),
  ])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage team members and invitations for this organization.
        </p>
      </div>
      <Suspense fallback={null}>
        <MembersClient
          members={members}
          invites={invites}
          inviteMember={inviteMember}
          revokeInvite={revokeInvite}
          removeMember={removeMember}
        />
      </Suspense>
    </div>
  )
}
