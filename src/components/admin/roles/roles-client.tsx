'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RoleMatrix } from '@/components/rbac/role-matrix'
import { getRoleConfig, saveRoleConfig } from '@/app/(admin)/admin/roles/_actions/role-config'
import type { ConfigurableRole, OrgRolesConfig, RoleOrgOption } from '@/lib/rbac/permissions'

interface Props {
  orgs: RoleOrgOption[]
  initialOrgId: string | null
  initialConfig: OrgRolesConfig | null
}

export function AdminRolesClient({ orgs, initialOrgId, initialConfig }: Props) {
  const [orgId, setOrgId] = useState<string | null>(initialOrgId)
  const [config, setConfig] = useState<OrgRolesConfig | null>(initialConfig)
  const [isLoading, startLoad] = useTransition()

  if (orgs.length === 0) {
    return <p className="text-sm text-text-secondary">No organizations found.</p>
  }

  function onOrgChange(next: string) {
    setOrgId(next)
    startLoad(async () => {
      const res = await getRoleConfig(next)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setConfig(res.config)
    })
  }

  return (
    <div className="space-y-5">
      <div className="max-w-sm space-y-1.5">
        <label className="text-[12px] font-medium text-text-secondary">Owner organization</label>
        <Select value={orgId ?? undefined} onValueChange={onOrgChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select an organization" />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {config && orgId ? (
        <RoleMatrix
          key={orgId}
          resetKey={orgId}
          config={config}
          disabled={isLoading}
          onSave={(role: ConfigurableRole, permissions, restrictToAssigned) =>
            saveRoleConfig({ orgId, role, permissions, restrictToAssigned })
          }
        />
      ) : null}
    </div>
  )
}
