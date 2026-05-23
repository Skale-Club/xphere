'use client'

import { useTransition, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TaskForm } from './task-form'
import { ContactInfoTemplate } from '@/components/contacts/contact-info-template'
import { createTask, updateTask, getContactsForPicker } from '@/app/(dashboard)/tasks/actions'
import type { TaskRow, ContactOption } from '@/app/(dashboard)/tasks/actions'
import type { CrmEntityType } from '@/types/database'
import { cn } from '@/lib/utils'

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
  const defaultContactId =
    task?.entity_type === 'contact' ? (task.entity_id ?? null) : (prefill?.entity_type === 'contact' ? prefill.entity_id ?? null : null)
  const [selectedContactId, setSelectedContactId] = useState<string | null>(defaultContactId)

  useEffect(() => {
    if (open) {
      getContactsForPicker().then(setContacts)
    }
  }, [open])

  useEffect(() => {
    if (open) setSelectedContactId(defaultContactId)
  }, [defaultContactId, open])

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className={cn(
          'gap-0 overflow-hidden p-0',
          selectedContactId
            ? 'w-[min(calc(100vw-2rem),768px)] max-w-none'
            : 'sm:max-w-md',
        )}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 z-10 rounded-[6px] p-1 text-text-tertiary opacity-70 transition-all duration-150 hover:bg-bg-tertiary hover:text-text-primary hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className={cn('grid max-h-[85vh]', selectedContactId ? 'md:grid-cols-[448px_320px]' : 'grid-cols-1')}>
          <div className="min-h-0 overflow-y-auto p-6">
            <DialogHeader>
              <DialogTitle>{task ? 'Edit Task' : 'New Task'}</DialogTitle>
            </DialogHeader>
            <div className="mt-5">
              <TaskForm
                defaultValues={
                  task
                    ? {
                        title: task.title,
                        description: task.description ?? '',
                        due_date: task.due_date ?? '',
                        priority: task.priority,
                        status: task.status,
                        contact_id: defaultContactId ?? undefined,
                      }
                    : undefined
                }
                prefill={prefill}
                contacts={contacts}
                onSubmit={handleSubmit}
                onContactChange={setSelectedContactId}
                loading={isPending}
                submitLabel={task ? 'Update Task' : 'Create Task'}
              />
            </div>
          </div>

          {selectedContactId && (
            <aside className="hidden min-h-0 border-l border-border-subtle md:block">
              <ContactInfoTemplate contactId={selectedContactId} />
            </aside>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
