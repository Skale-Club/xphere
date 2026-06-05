'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  UserPlus, Trash2, Loader2, ChevronLeft, ChevronRight, User, Plus, Pencil,
  Settings2,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { RoleMatrix } from '@/components/rbac/role-matrix'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'

import type { MemberProfile } from '@/app/(dashboard)/members/actions'
import type { OrgRolesConfig, ConfigurableRole } from '@/lib/rbac/permissions'
import {
  inviteMember, revokeInvite, removeMember, updateMemberRole,
} from '@/app/(dashboard)/members/actions'
import { saveBuiltinRoleConfig, deleteCustomRole, type CustomRole } from './actions'
import { CustomRoleDialog } from './custom-role-dialog'

// ── types ────────────────────────────────────────────────────────────────────

type Invite = {
  id: string
  email: string
  role: string
  invited_at: string
  accepted_at: string | null
  custom_role_id?: string | null
}

const INVITE_SCHEMA = z.object({
  email: z.string().email('Enter a valid email'),
  role: z.string().min(1, 'Select a role'),
})
type InviteValues = z.infer<typeof INVITE_SCHEMA>

// ── roles panel (sheet) ──────────────────────────────────────────────────────

interface RolesPanelProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  rolesConfig: OrgRolesConfig | null
  customRoles: CustomRole[]
}

function RolesPanel({ open, onOpenChange, rolesConfig, customRoles }: RolesPanelProps) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<CustomRole | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteCustomRole(id)
      if (result.error) { toast.error(result.error); return }
      toast.success('Role deleted')
      router.refresh()
    })
  }

  const enabledCount = (r: CustomRole) => Object.values(r.permissions).filter(Boolean).length

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-6">
            <DialogTitle>Roles & Permissions</DialogTitle>
          </DialogHeader>

          <div className="space-y-8">
            {/* Built-in roles */}
            <section>
              <div className="mb-4">
                <p className="text-[13px] font-semibold text-text-primary">Built-in roles</p>
                <p className="text-[12px] text-text-secondary mt-0.5">
                  Configure what Admins and Members can access in this organization.
                </p>
              </div>
              {rolesConfig ? (
                <RoleMatrix
                  config={rolesConfig}
                  onSave={(role: ConfigurableRole, permissions, restrictToAssigned) =>
                    saveBuiltinRoleConfig({ role, permissions, restrictToAssigned })
                  }
                />
              ) : (
                <p className="text-sm text-text-secondary">
                  Only admins and owners can manage roles and permissions.
                </p>
              )}
            </section>

            {/* Custom roles */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[13px] font-semibold text-text-primary">Custom roles</p>
                  <p className="text-[12px] text-text-secondary mt-0.5">
                    Named roles with a custom permission set you can assign to members.
                  </p>
                </div>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  New role
                </Button>
              </div>

              {customRoles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm text-text-secondary">No custom roles yet.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
                    Create your first role
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border">
                  {customRoles.map((role) => (
                    <div key={role.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-text-primary">{role.name}</p>
                        {role.description && (
                          <p className="text-[12px] text-text-secondary truncate">{role.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <Badge variant="secondary" className="text-[11px]">
                          {enabledCount(role)} perm{enabledCount(role) !== 1 ? 's' : ''}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditing(role)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDelete(role.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <CustomRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => router.refresh()}
      />
      <CustomRoleDialog
        open={!!editing}
        onOpenChange={(v) => { if (!v) setEditing(null) }}
        editing={editing}
        onSuccess={() => { setEditing(null); router.refresh() }}
      />
    </>
  )
}

// ── main client ──────────────────────────────────────────────────────────────

export interface MembersSettingsClientProps {
  members: MemberProfile[]
  invites: Invite[]
  total: number
  page: number
  perPage: number
  rolesConfig: OrgRolesConfig | null
  customRoles: CustomRole[]
}

export function MembersSettingsClient({
  members,
  invites,
  total,
  page,
  perPage,
  rolesConfig,
  customRoles,
}: MembersSettingsClientProps) {
  const router = useRouter()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const form = useForm<InviteValues>({
    resolver: zodResolver(INVITE_SCHEMA),
    defaultValues: { email: '', role: 'member' },
  })

  function onInviteSubmit(values: InviteValues) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('email', values.email)
      const customRole = customRoles.find((r) => r.id === values.role)
      if (customRole) {
        fd.set('role', 'member')
        fd.set('custom_role_id', customRole.id)
      } else {
        fd.set('role', values.role)
      }
      const result = await inviteMember(fd)
      if (result.error) { toast.error(result.error); return }
      toast.success(`Invitation sent to ${values.email}`)
      setInviteOpen(false)
      form.reset()
      router.refresh()
    })
  }

  function handleRevoke(inviteId: string, email: string) {
    startTransition(async () => {
      const result = await revokeInvite(inviteId)
      if (result.error) { toast.error(result.error); return }
      toast.success(`Invite for ${email} revoked`)
      router.refresh()
    })
  }

  function handleRemove(memberId: string) {
    startTransition(async () => {
      const result = await removeMember(memberId)
      if (result.error) { toast.error(result.error); return }
      toast.success('Member removed')
      router.refresh()
    })
  }

  function handleRoleChange(memberId: string, value: string) {
    startTransition(async () => {
      const role = (value === 'admin' || value === 'member') ? value : 'member'
      const result = await updateMemberRole(memberId, role)
      if (result.error) { toast.error(result.error); return }
      toast.success('Role updated')
      router.refresh()
    })
  }

  function goToPage(p: number) {
    router.push(`/settings/members?page=${p}`)
  }

  const pendingInvites = invites.filter((i) => !i.accepted_at)

  return (
    <div className="space-y-8">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-3">
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="h-4 w-4 mr-2" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Invite a new member</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onInviteSubmit)} className="space-y-4 pt-2">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="colleague@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                          {customRoles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Inviting…</>
                      : 'Send Invite'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Button variant="outline" size="sm" onClick={() => setRolesOpen(true)}>
          <Settings2 className="h-4 w-4 mr-2" />
          Roles
        </Button>
      </div>

      {/* Members table */}
      <section>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-14" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No members yet.
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7 shrink-0">
                        {member.avatar_url && <AvatarImage src={member.avatar_url} alt="" />}
                        <AvatarFallback className="text-[11px] font-semibold bg-muted text-muted-foreground">
                          {(member.full_name ?? member.email ?? '?')
                            .replace(/[^a-zA-Z0-9 ]/g, ' ')
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((p: string) => p[0].toUpperCase())
                            .join('') || <User className="h-3.5 w-3.5" />}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {member.full_name ?? <span className="text-muted-foreground">—</span>}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatEmailDisplay(member.email) || '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.phone ? formatPhoneDisplay(member.phone) : '—'}
                  </TableCell>
                  <TableCell>
                    {member.role === 'owner' ? (
                      <Badge variant="secondary" className="text-[11px] font-medium">Owner</Badge>
                    ) : (
                      <Select
                        value={member.role}
                        onValueChange={(v) => handleRoleChange(member.id, v)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="h-7 w-[110px] text-xs border-0 bg-transparent px-2 gap-1 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                          {customRoles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(member.joined_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {member.role !== 'owner' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(member.id)}
                        disabled={isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t mt-2">
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8"
                onClick={() => goToPage(page - 1)} disabled={page <= 1 || isPending}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, idx) =>
                  p === 'ellipsis' ? (
                    <span key={`e-${idx}`} className="px-1 text-muted-foreground text-xs">…</span>
                  ) : (
                    <Button key={p} variant={p === page ? 'default' : 'outline'}
                      size="icon" className="h-8 w-8 text-xs"
                      onClick={() => goToPage(p as number)} disabled={isPending}>
                      {p}
                    </Button>
                  )
                )}
              <Button variant="outline" size="icon" className="h-8 w-8"
                onClick={() => goToPage(page + 1)} disabled={page >= totalPages || isPending}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Pending Invites
            <Badge variant="secondary" className="ml-2">{String(pendingInvites.length)}</Badge>
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingInvites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="text-sm">{formatEmailDisplay(invite.email)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{invite.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(invite.invited_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon"
                      onClick={() => handleRevoke(invite.id, invite.email)} disabled={isPending}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {/* Roles panel */}
      <RolesPanel
        open={rolesOpen}
        onOpenChange={setRolesOpen}
        rolesConfig={rolesConfig}
        customRoles={customRoles}
      />
    </div>
  )
}
