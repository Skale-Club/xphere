'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  LayoutDashboard,
  MessageSquare,
  Phone,
  Bot,
  Megaphone,
  Contact,
  Building2,
  TrendingUp,
  CheckSquare,
  CalendarDays,
  Zap,
  FolderKanban,
  Star,
  BarChart3,
  BookOpen,
  Plug2,
  Mail,
  Settings,
  Users,
  UserPlus,
  CreditCard,
  Info,
  Search,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  PERMISSION_GROUPS,
  type ConfigurableRole,
  type OrgRolesConfig,
} from '@/lib/rbac/permissions'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  MessageSquare,
  Phone,
  Bot,
  Megaphone,
  Contact,
  Building2,
  TrendingUp,
  CheckSquare,
  CalendarDays,
  Zap,
  FolderKanban,
  Star,
  BarChart3,
  BookOpen,
  Plug2,
  Mail,
  Settings,
  Users,
  UserPlus,
  CreditCard,
}

/** Only org-level groups are configurable here (platform-only excluded). */
const ORG_GROUPS = PERMISSION_GROUPS.filter((g) => !g.platformOnly)

const ROLE_LABELS: Record<ConfigurableRole, string> = { admin: 'Admin', member: 'User' }

const RESTRICT_NOTE =
  'Keep this off to give the role access to all records in the organization. ' +
  'Turn it on to limit visibility to only the records assigned to them ' +
  '(contacts, opportunities, tasks, calendar). Note: for Admins this does not ' +
  'apply to contacts, opportunities and tasks — they keep full visibility into those.'

function cloneConfig(c: OrgRolesConfig): OrgRolesConfig {
  return {
    admin: {
      permissions: { ...c.admin.permissions },
      restrictToAssigned: c.admin.restrictToAssigned,
    },
    member: {
      permissions: { ...c.member.permissions },
      restrictToAssigned: c.member.restrictToAssigned,
    },
  }
}

interface Props {
  config: OrgRolesConfig
  onSave: (
    role: ConfigurableRole,
    permissions: Record<string, boolean>,
    restrictToAssigned: boolean,
  ) => Promise<{ error: string | null }>
  /** Change this (e.g. to the org id) to reset the matrix to a fresh config. */
  resetKey?: string
  disabled?: boolean
  /**
   * Lift the sticky footer clear of the Copilot launcher, which is pinned to the
   * bottom-right of every dashboard page. Only needed when the matrix renders
   * directly on a page | dialogs portal above the launcher already.
   */
  clearsCopilotLauncher?: boolean
}

export function RoleMatrix({ config, onSave, resetKey, disabled, clearsCopilotLauncher }: Props) {
  const [role, setRole] = useState<ConfigurableRole>('admin')
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState<OrgRolesConfig>(() => cloneConfig(config))
  const [draft, setDraft] = useState<OrgRolesConfig>(() => cloneConfig(config))
  const [isSaving, startSave] = useTransition()

  // Reset when the underlying org/config changes (admin org switch).
  useEffect(() => {
    setSaved(cloneConfig(config))
    setDraft(cloneConfig(config))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const current = draft[role]
  const dirty = useMemo(
    () => JSON.stringify(draft[role]) !== JSON.stringify(saved[role]),
    [draft, saved, role],
  )

  function setPermission(key: string, value: boolean) {
    setDraft((d) => ({
      ...d,
      [role]: { ...d[role], permissions: { ...d[role].permissions, [key]: value } },
    }))
  }

  function setGroup(keys: string[], value: boolean) {
    setDraft((d) => {
      const permissions = { ...d[role].permissions }
      for (const k of keys) permissions[k] = value
      return { ...d, [role]: { ...d[role], permissions } }
    })
  }

  function setRestrict(value: boolean) {
    setDraft((d) => ({ ...d, [role]: { ...d[role], restrictToAssigned: value } }))
  }

  function onCancel() {
    setDraft((d) => ({
      ...d,
      [role]: {
        permissions: { ...saved[role].permissions },
        restrictToAssigned: saved[role].restrictToAssigned,
      },
    }))
  }

  function handleSave() {
    startSave(async () => {
      const res = await onSave(role, draft[role].permissions, draft[role].restrictToAssigned)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setSaved((s) => ({
        ...s,
        [role]: {
          permissions: { ...draft[role].permissions },
          restrictToAssigned: draft[role].restrictToAssigned,
        },
      }))
      toast.success(`${ROLE_LABELS[role]} permissions saved`)
    })
  }

  const q = search.trim().toLowerCase()
  const groups = q
    ? ORG_GROUPS.filter(
        (g) =>
          g.label.toLowerCase().includes(q) ||
          g.permissions.some((p) => p.label.toLowerCase().includes(q)),
      )
    : ORG_GROUPS

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5">
        {/* Role selector */}
        <div className="max-w-sm space-y-1.5">
          <label className="text-[12px] font-medium text-text-secondary">User role</label>
          <Select value={role} onValueChange={(v) => setRole(v as ConfigurableRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Restrict-to-assigned seal */}
        <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-secondary px-4 py-3">
          <Switch
            checked={current.restrictToAssigned}
            onCheckedChange={setRestrict}
            disabled={disabled}
          />
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
            Restrict data visibility to only assigned data
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-text-tertiary" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                {RESTRICT_NOTE}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="pl-8"
          />
        </div>

        {/* Groups */}
        <div className="border-y border-border-subtle divide-y divide-border-subtle">
          {groups.map((group) => {
            const keys = group.permissions.map((p) => p.key)
            const groupOn = keys.some((k) => current.permissions[k])
            const Icon = ICONS[group.icon]
            return (
              <div key={group.key} className="py-4">
                <div className="flex items-center gap-2.5">
                  <Switch
                    checked={groupOn}
                    onCheckedChange={(v) => setGroup(keys, v)}
                    disabled={disabled}
                  />
                  {Icon ? <Icon className="h-4 w-4 text-text-secondary" /> : null}
                  <span className="text-[13.5px] font-medium text-text-primary">
                    {group.label}
                  </span>
                </div>
                {groupOn ? (
                  <div className="ml-12 mt-3 grid gap-2">
                    {group.permissions.map((p) => (
                      <label
                        key={p.key}
                        className="flex cursor-pointer items-center gap-2.5 text-[13px] text-text-secondary"
                      >
                        <Checkbox
                          checked={!!current.permissions[p.key]}
                          onCheckedChange={(v) => setPermission(p.key, v === true)}
                          disabled={disabled}
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div
          className={cn(
            'sticky flex items-center justify-end gap-2 bg-bg-primary/80 py-3 backdrop-blur',
            clearsCopilotLauncher ? 'bottom-24' : 'bottom-0',
          )}
        >
          <Button variant="ghost" onClick={onCancel} disabled={!dirty || isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!dirty || isSaving || disabled}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
