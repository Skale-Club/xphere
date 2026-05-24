'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
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
import { Skeleton } from '@/components/ui/skeleton'
import { createAssistantMapping, updateAssistantMapping } from '@/app/(dashboard)/assistants/actions'
import type { Database } from '@/types/database'

type AssistantMapping = Database['public']['Tables']['assistant_mappings']['Row']

interface VapiAssistant {
  id: string
  name?: string
}

const assistantMappingSchema = z.object({
  vapi_assistant_id: z.string().min(1, 'Vapi assistant is required.'),
  name: z
    .string()
    .trim()
    .min(1, 'Assistant name is required.')
    .max(100, 'Assistant name must be 100 characters or fewer.'),
})

type AssistantMappingFormValues = z.infer<typeof assistantMappingSchema>

interface AssistantMappingFormProps {
  mode: 'create' | 'edit'
  mapping?: AssistantMapping
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AssistantMappingForm({
  mode,
  mapping,
  open,
  onOpenChange,
  onSuccess,
}: AssistantMappingFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [assistants, setAssistants] = useState<VapiAssistant[]>([])
  const [assistantsLoading, setAssistantsLoading] = useState(false)
  const [assistantsError, setAssistantsError] = useState<string | null>(null)

  const form = useForm<AssistantMappingFormValues>({
    resolver: zodResolver(assistantMappingSchema),
    defaultValues: {
      vapi_assistant_id: mapping?.vapi_assistant_id ?? '',
      name: mapping?.name ?? '',
    },
  })

  // Reset form when mapping changes (edit mode) or dialog opens/closes
  useEffect(() => {
    if (open) {
      form.reset({
        vapi_assistant_id: mapping?.vapi_assistant_id ?? '',
        name: mapping?.name ?? '',
      })
    }
  }, [open, mapping, form])

  // Fetch Vapi assistants when dialog opens
  useEffect(() => {
    if (!open) return

    let cancelled = false
    async function fetchAssistants() {
      setAssistantsLoading(true)
      setAssistantsError(null)
      try {
        const res = await fetch('/api/vapi/assistants')
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Failed to load assistants (${res.status})`)
        }
        const data = await res.json()
        // Vapi returns { assistants: [...] } or an array depending on API version
        const list: VapiAssistant[] = Array.isArray(data)
          ? data
          : Array.isArray(data.assistants)
            ? data.assistants
            : []
        if (!cancelled) setAssistants(list)
      } catch (err) {
        if (!cancelled) {
          setAssistantsError(err instanceof Error ? err.message : 'Failed to load assistants')
        }
      } finally {
        if (!cancelled) setAssistantsLoading(false)
      }
    }
    fetchAssistants()
    return () => {
      cancelled = true
    }
  }, [open])

  async function onSubmit(values: AssistantMappingFormValues) {
    setIsSubmitting(true)
    try {
      let result: { error?: string } | undefined

      if (mode === 'create') {
        result = await createAssistantMapping({
          vapi_assistant_id: values.vapi_assistant_id,
          name: values.name || undefined,
        })
      } else if (mode === 'edit' && mapping) {
        result = await updateAssistantMapping(mapping.id, {
          vapi_assistant_id: values.vapi_assistant_id,
          name: values.name || undefined,
        })
      }

      if (result?.error) {
        if (result.error === 'This assistant ID is already mapped to an organization.') {
          toast.error('This assistant is already mapped to an organization.')
        } else if (result.error === 'Assistant name is required.') {
          toast.error('Assistant name is required.')
        } else {
          toast.error('Failed to save. Try again.')
        }
        return
      }

      toast.success(mode === 'create' ? 'Vapi assistant linked.' : 'Mapping updated.')
      form.reset()
      onOpenChange(false)
      onSuccess()
    } finally {
      setIsSubmitting(false)
    }
  }

  const title = mode === 'create' ? 'Link Vapi Assistant' : 'Edit Mapping'
  const submitLabel = mode === 'create' ? 'Link Assistant' : 'Save Changes'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assistant Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Lead Capture Assistant" {...field} />
                  </FormControl>
                  <FormDescription>
                    Use the same human-friendly name your team recognizes in Vapi.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vapi_assistant_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vapi Assistant</FormLabel>
                  <FormControl>
                    {assistantsLoading ? (
                      <Skeleton className="h-10 w-full" />
                    ) : assistantsError ? (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {assistantsError}
                      </div>
                    ) : assistants.length === 0 ? (
                      <div className="rounded-md border border-muted px-3 py-2 text-sm text-muted-foreground">
                        No assistants found in your Vapi account.
                      </div>
                    ) : (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a Vapi assistant" />
                        </SelectTrigger>
                        <SelectContent>
                          {assistants.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name || a.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormControl>
                  <FormDescription>
                    This links the assistant for call routing. The name above is what people see in the platform.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || assistantsLoading || assistants.length === 0}
              >
                {isSubmitting ? 'Saving...' : submitLabel}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
