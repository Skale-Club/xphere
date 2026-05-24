'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createTask } from '@/app/(dashboard)/projects/actions'
import type { ProjectTaskStep, TaskPriority } from '@/types/database'

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
})

type FormValues = z.infer<typeof schema>

interface Props {
  projectId: string
  defaultStep?: ProjectTaskStep
  parentTaskId?: string
  children: React.ReactNode
  onCreated?: () => void
}

export function NewTaskDialog({ projectId, defaultStep = 'backlog', parentTaskId, children, onCreated }: Props) {
  const [open, setOpen] = React.useState(false)

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', priority: 'medium' as const },
  })

  const priority = watch('priority')

  async function onSubmit(values: FormValues) {
    try {
      await createTask({
        project_id: projectId,
        name: values.name,
        step: defaultStep,
        priority: values.priority as TaskPriority,
        parent_task_id: parentTaskId,
      })
      toast.success(parentTaskId ? 'Subtask created' : 'Task created')
      setOpen(false)
      reset()
      onCreated?.()
    } catch {
      toast.error('Failed to create task')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{parentTaskId ? 'New Subtask' : 'New Task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="task-name">Name</Label>
            <Input id="task-name" placeholder="Task name" {...register('name')} autoFocus />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setValue('priority', v as TaskPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
