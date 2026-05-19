'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TaskForm } from './task-form'
import { createTask, updateTask } from '@/app/(dashboard)/tasks/actions'
import type { TaskRow } from '@/app/(dashboard)/tasks/actions'
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{task ? 'Edit Task' : 'New Task'}</SheetTitle>
        </SheetHeader>
        <TaskForm
          defaultValues={
            task
              ? {
                  title: task.title,
                  description: task.description ?? '',
                  due_date: task.due_date ?? '',
                  priority: task.priority,
                  status: task.status,
                }
              : undefined
          }
          prefill={prefill}
          onSubmit={handleSubmit}
          loading={isPending}
          submitLabel={task ? 'Update Task' : 'Create Task'}
        />
      </SheetContent>
    </Sheet>
  )
}
