'use client'

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
import { Textarea } from '@/components/ui/textarea'
import type { CrmEntityType } from '@/types/database'

const schema = z.object({
  title: z.string().max(255).optional(),
  content: z.string().min(1, 'Content is required').max(50000),
})

type FormValues = z.infer<typeof schema>

interface NoteFormProps {
  defaultValues?: Partial<FormValues>
  prefill?: { entity_type?: CrmEntityType; entity_id?: string }
  onSubmit: (values: FormValues & { entity_type?: CrmEntityType; entity_id?: string }) => Promise<void>
  loading?: boolean
  submitLabel?: string
}

export function NoteForm({
  defaultValues,
  prefill,
  onSubmit,
  loading,
  submitLabel = 'Save Note',
}: NoteFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      content: '',
      ...defaultValues,
    },
  })

  async function handleSubmit(values: FormValues) {
    await onSubmit({
      ...values,
      entity_type: prefill?.entity_type,
      entity_id: prefill?.entity_id,
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
              <FormLabel>Title <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
              <FormControl>
                <Input placeholder="Note title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Content</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Write your note here…"
                  className="resize-none"
                  rows={8}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Saving…' : submitLabel}
        </Button>
      </form>
    </Form>
  )
}
