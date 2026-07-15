'use client'

import { RoleMatrix } from '@/components/rbac/role-matrix'
import { saveOwnRoleConfig } from '@/app/(dashboard)/settings/roles/actions'
import type { ConfigurableRole, OrgRolesConfig } from '@/lib/rbac/permissions'

export function OwnerRolesClient({ initialConfig }: { initialConfig: OrgRolesConfig }) {
  return (
    <RoleMatrix
      config={initialConfig}
      clearsCopilotLauncher
      onSave={(role: ConfigurableRole, permissions, restrictToAssigned) =>
        saveOwnRoleConfig({ role, permissions, restrictToAssigned })
      }
    />
  )
}
