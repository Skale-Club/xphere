'use client'

import * as React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { TaskAssigneeAvatar } from './task-assignee-avatar'
import { listProjectAssignees, updateTaskAssignee } from '@/app/(dashboard)/projects/actions'
import type { AssigneeProfile } from '@/app/(dashboard)/projects/actions'
import { toast } from 'sonner'
import { UserPlus2, X } from 'lucide-react'

interface Props {
  taskId: string
  projectId: string
  current: AssigneeProfile | null
  onChange?: (m: AssigneeProfile | null) => void
}

export function AssigneePicker({ taskId, projectId, current, onChange }: Props) {
  const [open, setOpen] = React.useState(false)
  const [members, setMembers] = React.useState<AssigneeProfile[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (open && members.length === 0) {
      setLoading(true)
      listProjectAssignees()
        .then((m) => setMembers(m))
        .finally(() => setLoading(false))
    }
  }, [open, members.length])

  async function assign(m: AssigneeProfile | null) {
    try {
      await updateTaskAssignee(taskId, projectId, m?.user_id ?? null)
      onChange?.(m)
      setOpen(false)
    } catch {
      toast.error('Failed to assign')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5">
          {current ? (
            <>
              <TaskAssigneeAvatar name={current.full_name} email={current.email} size="xs" />
              <span className="truncate max-w-[140px]">{current.full_name ?? current.email}</span>
            </>
          ) : (
            <>
              <UserPlus2 className="h-3.5 w-3.5" />
              <span>Assign</span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search members..." />
          <CommandList>
            {loading && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
            <CommandEmpty>No members</CommandEmpty>
            <CommandGroup>
              {current && (
                <CommandItem onSelect={() => assign(null)} className="text-muted-foreground">
                  <X className="h-3.5 w-3.5 mr-2" />
                  Unassign
                </CommandItem>
              )}
              {members.map((m) => (
                <CommandItem key={m.user_id} onSelect={() => assign(m)}>
                  <TaskAssigneeAvatar
                    name={m.full_name}
                    email={m.email}
                    size="xs"
                    className="mr-2"
                  />
                  <span className="truncate">{m.full_name ?? m.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
