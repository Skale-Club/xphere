'use client'

import { useTransition, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TaskForm } from './task-form'
import { createTask, updateTask, getContactsForPicker } from '@/app/(dashboard)/tasks/actions'
import type { TaskRow, ContactOption } from '@/app/(dashboard)/tasks/actions'
import type { CrmEntityType } from '@/types/database'

interface TaskSlideOverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: TaskRow | null
  prefill?: { entity_type?: CrmEntityType; entity_id?: string }
}

export function TaskSlideOver({ open, onOpenChange, task, prefill }: TaskSlideOverProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [contacts, setContacts] = useState<ContactOption[]>([])

  useEffect(() => {
    if (open) {
      getContactsForPicker().then(setContacts)
    }
  }, [open])

  async function handleSubmit(values: Parameters<React.ComponentProps<typeof TaskForm>['onSubmit']>[0]) {
    startTransition(async () => {
      const result = task
        ? await updateTask(task.id, values)
        : await createTask(values)

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success(task ? 'Task updated' : 'Task created')
      onOpenChange(false)
      router.refresh()
    })
  }

  const defaultContactId =
    task?.entity_type === 'contact' ? (task.entity_id ?? undefined) : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'New Task'}</DialogTitle>
        </DialogHeader>
        <TaskForm
          defaultValues={
            task
              ? {
                  title: task.title,
                  description: task.description ?? '',
                  due_date: task.due_date ?? '',
                  priority: task.priority,
                  status: task.status,
                  contact_id: defaultContactId,
                }
              : undefined
          }
          prefill={prefill}
          contacts={contacts}
          onSubmit={handleSubmit}
          loading={isPending}
          submitLabel={task ? 'Update Task' : 'Create Task'}
        />
      </DialogContent>
    </Dialog>
  )
}
