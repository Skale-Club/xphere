import { AdminRolesClient } from '@/components/admin/roles/roles-client'
import { getRoleConfig, listOrgsForRoles } from './_actions/role-config'

export default async function AdminRolesPage() {
  const { error, orgs } = await listOrgsForRoles()

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text-primary">Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Configure what each role can see and do, per owner organization.
          </p>
        </div>
        <p className="text-sm text-text-secondary">{error}</p>
      </div>
    )
  }

  const initialOrgId = orgs[0]?.id ?? null
  const initialConfig = initialOrgId ? (await getRoleConfig(initialOrgId)).config : null

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Roles &amp; Permissions</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Select an owner organization and configure what its Admins and Users can see and do.
        </p>
      </div>
      <AdminRolesClient orgs={orgs} initialOrgId={initialOrgId} initialConfig={initialConfig} />
    </div>
  )
}
