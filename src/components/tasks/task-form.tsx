'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { CrmEntityType, TaskPriority, TaskStatus } from '@/types/database'
import type { TaskRow, ContactOption } from '@/app/(dashboard)/tasks/actions'
import { displayContactName } from '@/lib/contacts/names'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'

function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const QUICK_DATES = [
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'Next week', offset: 7 },
] as const

const schema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(5000).optional(),
  due_date: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
  contact_id: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface TaskFormProps {
  defaultValues?: Partial<FormValues>
  prefill?: { entity_type?: CrmEntityType; entity_id?: string }
  contacts?: ContactOption[]
  onSubmit: (values: Omit<FormValues, 'contact_id'> & { entity_type?: CrmEntityType; entity_id?: string }) => Promise<void>
  onContactChange?: (contactId: string | null) => void
  loading?: boolean
  submitLabel?: string
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

export function TaskForm({
  defaultValues,
  prefill,
  contacts = [],
  onSubmit,
  onContactChange,
  loading,
  submitLabel = 'Save Task',
}: TaskFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      due_date: '',
      priority: 'medium',
      status: 'todo',
      contact_id: undefined,
      ...defaultValues,
    },
  })

  const selectedContactId =
    form.watch('contact_id') ?? (prefill?.entity_type === 'contact' ? prefill.entity_id : undefined)

  useEffect(() => {
    onContactChange?.(selectedContactId ?? null)
  }, [onContactChange, selectedContactId])

  async function handleSubmit(values: FormValues) {
    const { contact_id, due_date, ...rest } = values
    const entityFromContact =
      contact_id && !prefill?.entity_type
        ? { entity_type: 'contact' as CrmEntityType, entity_id: contact_id }
        : {}
    await onSubmit({
      ...rest,
      due_date: due_date ? new Date(due_date).toISOString() : undefined,
      entity_type: prefill?.entity_type ?? entityFromContact.entity_type,
      entity_id: prefill?.entity_id ?? entityFromContact.entity_id,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="Task title" {...field} />
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
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Optional details..."
                  className="resize-none"
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="due_date"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Due Date</FormLabel>
                <div className="flex gap-1">
                  {QUICK_DATES.map(({ label, offset }) => {
                    const d = new Date()
                    d.setDate(d.getDate() + offset)
                    d.setHours(17, 0, 0, 0)
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => field.onChange(toDatetimeLocal(d))}
                        className="text-[0.7rem] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-colors"
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <FormControl>
                <Input type="datetime-local" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {!prefill?.entity_type && contacts.length > 0 && (
          <FormField
            control={form.control}
            name="contact_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Contact{' '}
                  <span className="text-[0.75rem] text-muted-foreground font-normal">(optional)</span>
                </FormLabel>
                <Select onValueChange={(v) => field.onChange(v === '__none__' ? undefined : v)} value={field.value ?? '__none__'}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Link to a contact…" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">No contact</SelectItem>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {displayContactName(c, c.email ?? (c.phone ? formatPhoneDisplay(c.phone) : null) ?? 'Unknown')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Saving…' : submitLabel}
        </Button>
      </form>
    </Form>
  )
}
