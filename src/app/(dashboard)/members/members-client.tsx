'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  UserPlus, Trash2, Loader2, ChevronLeft, ChevronRight, User,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { MemberProfile } from './actions'

type Invite = {
  id: string
  email: string
  role: string
  invited_at: string
  accepted_at: string | null
}

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email'),
  role: z.enum(['admin', 'member']),
})
type InviteFormValues = z.infer<typeof inviteSchema>

interface MembersClientProps {
  members: MemberProfile[]
  invites: Invite[]
  total: number
  page: number
  perPage: number
  inviteMember: (formData: FormData) => Promise<{ error: string | null | undefined }>
  revokeInvite: (id: string) => Promise<{ error: string | null | undefined }>
  removeMember: (id: string) => Promise<{ error: string | null | undefined }>
}

export function MembersClient({
  members,
  invites,
  total,
  page,
  perPage,
  inviteMember,
  revokeInvite,
  removeMember,
}: MembersClientProps) {
  const router = useRouter()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'member' },
  })

  function onInviteSubmit(values: InviteFormValues) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('email', values.email)
      fd.set('role', values.role)
      const result = await inviteMember(fd)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Invitation sent to ${values.email}`)
      setInviteOpen(false)
      form.reset()
      router.refresh()
    })
  }

  function handleRevoke(inviteId: string, email: string) {
    startTransition(async () => {
      const result = await revokeInvite(inviteId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Invite for ${email} revoked`)
      router.refresh()
    })
  }

  function handleRemove(memberId: string) {
    startTransition(async () => {
      const result = await removeMember(memberId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Member removed')
      router.refresh()
    })
  }

  function goToPage(p: number) {
    const params = new URLSearchParams()
    params.set('page', String(p))
    router.push(`/members?${params.toString()}`)
  }

  const pendingInvites = invites.filter(i => !i.accepted_at)

  return (
    <div className="space-y-8">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{String(total)}</Badge>
          {total === 1 ? 'member' : 'members'}
        </div>
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
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setInviteOpen(false)}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Inviting...</>
                      : 'Send Invite'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
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
              members.map(member => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted shrink-0">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <span className="text-sm font-medium">
                        {member.full_name ?? <span className="text-muted-foreground">—</span>}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.email ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.phone ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>
                      {member.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(member.joined_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(member.id)}
                      disabled={isPending}
                      title="Remove member"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t mt-2">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || isPending}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, idx) =>
                  p === 'ellipsis' ? (
                    <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground text-xs">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === page ? 'default' : 'outline'}
                      size="icon"
                      className="h-8 w-8 text-xs"
                      onClick={() => goToPage(p as number)}
                      disabled={isPending}
                    >
                      {p}
                    </Button>
                  )
                )}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || isPending}
              >
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
              {pendingInvites.map(invite => (
                <TableRow key={invite.id}>
                  <TableCell className="text-sm">{invite.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{invite.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(invite.invited_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRevoke(invite.id, invite.email)}
                      disabled={isPending}
                      title="Revoke invite"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  )
}
