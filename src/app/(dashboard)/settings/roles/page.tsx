import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { OwnerRolesClient } from '@/components/settings/roles/owner-roles-client'
import { getOwnRolesConfig } from './actions'

export default async function RolesSettingsPage() {
  const { error, config } = await getOwnRolesConfig()
  if (error === 'Not authenticated') redirect('/')
  if (error === 'No active organization') redirect('/organizations')

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow="Settings"
        eyebrowIcon={ShieldCheck}
        title="Roles & Permissions"
        description="Control what your Admins and Users can see and do in this organization."
      />
      {config ? (
        <OwnerRolesClient initialConfig={config} />
      ) : (
        <p className="text-sm text-text-secondary">
          Only the organization owner can manage roles and permissions.
        </p>
      )}
    </PageContainer>
  )
}
