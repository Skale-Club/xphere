'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  LayoutDashboard, MessageSquare, Phone, Bot, Megaphone, Contact, Building2,
  TrendingUp, CheckSquare, CalendarDays, Zap, FolderKanban, Star, BarChart3,
  BookOpen, Plug2, Mail, Settings, Users, CreditCard, type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { PERMISSION_GROUPS } from '@/lib/rbac/permissions'
import { createCustomRole, updateCustomRole, type CustomRole } from './actions'

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, MessageSquare, Phone, Bot, Megaphone, Contact, Building2,
  TrendingUp, CheckSquare, CalendarDays, Zap, FolderKanban, Star, BarChart3,
  BookOpen, Plug2, Mail, Settings, Users, CreditCard,
}

const ORG_GROUPS = PERMISSION_GROUPS.filter((g) => !g.platformOnly)

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(64),
  description: z.string().max(256).optional(),
})
type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing?: CustomRole | null
  onSuccess: () => void
}

export function CustomRoleDialog({ open, onOpenChange, editing, onSuccess }: Props) {
  const isEdit = !!editing

  const allKeys = ORG_GROUPS.flatMap((g) => g.permissions.map((p) => p.key))
  const initPerms: Record<string, boolean> = {}
  for (const key of allKeys) {
    initPerms[key] = editing?.permissions[key] ?? false
  }
  const [permissions, setPermissions] = useState<Record<string, boolean>>(initPerms)
  const [isPending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: editing?.name ?? '', description: editing?.description ?? '' },
  })

  function togglePermission(key: string, value: boolean) {
    setPermissions((p) => ({ ...p, [key]: value }))
  }

  function toggleGroup(keys: string[], value: boolean) {
    setPermissions((p) => {
      const next = { ...p }
      for (const k of keys) next[k] = value
      return next
    })
  }

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = isEdit
        ? await updateCustomRole(editing!.id, { ...values, permissions })
        : await createCustomRole({ ...values, permissions })

      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(isEdit ? 'Role updated' : 'Role created')
      onSuccess()
      onOpenChange(false)
    })
  }

  // Reset when dialog reopens for a different role
  function handleOpenChange(v: boolean) {
    if (!v) form.reset()
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit role' : 'Create custom role'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Sales Manager" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description <span className="text-text-tertiary font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <Input placeholder="What this role can do..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-3">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-text-tertiary">
                Permissions
              </p>
              <div className="divide-y divide-border rounded-lg border">
                {ORG_GROUPS.map((group) => {
                  const keys = group.permissions.map((p) => p.key)
                  const Icon = ICONS[group.icon] ?? Settings
                  const enabledCount = keys.filter((k) => permissions[k]).length
                  const allOn = enabledCount === keys.length
                  const anyOn = enabledCount > 0

                  return (
                    <div key={group.key} className="px-4 py-3">
                      <div className="flex items-center gap-3 mb-2">
                        <Checkbox
                          checked={allOn ? true : anyOn ? 'indeterminate' : false}
                          onCheckedChange={(v) => toggleGroup(keys, !!v)}
                        />
                        <Icon className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                        <span className="text-[13px] font-medium">{group.label}</span>
                        {enabledCount > 0 && (
                          <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1.5">
                            {enabledCount}/{keys.length}
                          </Badge>
                        )}
                      </div>
                      <div className="ml-[26px] flex flex-col gap-1.5">
                        {group.permissions.map((perm) => (
                          <label key={perm.key} className="flex items-center gap-2.5 cursor-pointer">
                            <Checkbox
                              checked={permissions[perm.key] ?? false}
                              onCheckedChange={(v) => togglePermission(perm.key, !!v)}
                            />
                            <span className="text-[12.5px] text-text-secondary">{perm.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create role'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
