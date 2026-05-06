'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, X } from 'lucide-react'
import type { ToolConfigWithIntegration, ToolFolder } from '@/app/(dashboard)/tools/actions'
import type { IntegrationForDisplay } from '@/app/(dashboard)/integrations/actions'
import { createToolConfig, updateToolConfig } from '@/app/(dashboard)/tools/actions'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const toolConfigSchema = z.object({
  toolName: z
    .string()
    .min(1, 'Tool name is required')
    .max(100, 'Tool name must be 100 characters or fewer'),
  actionType: z.enum([
    'create_contact',
    'get_availability',
    'create_appointment',
    'send_sms',
    'knowledge_base',
    'custom_webhook',
  ]),
  integrationId: z.string().uuid('Please select an integration'),
  fallbackMessage: z
    .string()
    .min(1, 'Fallback message is required')
    .max(500, 'Fallback message must be 500 characters or fewer'),
  folder_id: z.string().uuid().optional().nullable(),
  labels: z.array(z.string()),
})

type ToolConfigFormValues = z.infer<typeof toolConfigSchema>

const ACTION_TYPE_OPTIONS = [
  { value: 'create_contact', label: 'Create Contact' },
  { value: 'get_availability', label: 'Check Availability' },
  { value: 'create_appointment', label: 'Book Appointment' },
  { value: 'send_sms', label: 'Send SMS' },
  { value: 'knowledge_base', label: 'Knowledge Base' },
  { value: 'custom_webhook', label: 'Custom Webhook' },
] as const

interface ToolConfigFormProps {
  mode: 'create' | 'edit'
  toolConfig?: ToolConfigWithIntegration
  integrations: IntegrationForDisplay[]
  existingFolders?: ToolFolder[]
  onSuccess: () => void
}

export function ToolConfigForm({ mode, toolConfig, integrations, existingFolders, onSuccess }: ToolConfigFormProps) {
  const [isPending, setIsPending] = useState(false)
  const [labelsInput, setLabelsInput] = useState('')

  const form = useForm<ToolConfigFormValues>({
    resolver: zodResolver(toolConfigSchema),
    mode: 'onSubmit',
    defaultValues: {
      toolName: toolConfig?.tool_name ?? '',
      actionType: toolConfig?.action_type ?? 'create_contact',
      integrationId: toolConfig?.integration_id ?? '',
      fallbackMessage: toolConfig?.fallback_message ?? '',
      folder_id: toolConfig?.folder_id ?? null,
      labels: toolConfig?.labels ?? [],
    },
  })

  const currentLabels: string[] = form.watch('labels') ?? []

  function addLabel(value: string) {
    const trimmed = value.trim().replace(/,$/, '')
    if (!trimmed || currentLabels.includes(trimmed)) return
    form.setValue('labels', [...currentLabels, trimmed])
    setLabelsInput('')
  }

  function removeLabel(label: string) {
    form.setValue('labels', currentLabels.filter((l) => l !== label))
  }

  async function onSubmit(values: ToolConfigFormValues) {
    // Flush any pending label input
    if (labelsInput.trim()) addLabel(labelsInput)

    setIsPending(true)
    try {
      const payload = {
        toolName: values.toolName,
        actionType: values.actionType,
        integrationId: values.integrationId,
        fallbackMessage: values.fallbackMessage,
        folder_id: values.folder_id || null,
        labels: values.labels,
      }

      let result: { error?: string } | void = undefined
      if (mode === 'create') {
        result = await createToolConfig(payload)
      } else if (toolConfig) {
        result = await updateToolConfig(toolConfig.id, payload)
      }

      if (result && 'error' in result && result.error) {
        if (result.error.includes('already exists')) {
          toast.error(result.error)
        } else {
          toast.error('Failed to save. Try again.')
        }
        return
      }

      toast.success('Tool configuration saved.')
      onSuccess()
    } catch {
      toast.error('Failed to save. Try again.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">
          {mode === 'create' ? 'New Tool Configuration' : 'Edit Tool Configuration'}
        </h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="toolName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tool Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. create_contact"
                    disabled={isPending}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Must match the tool name exactly as configured in Vapi
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="actionType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Action Type</FormLabel>
                <Select
                  disabled={isPending}
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an action type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ACTION_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
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
            name="integrationId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Integration</FormLabel>
                <Select
                  disabled={isPending}
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an integration" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {integrations.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No integrations available
                      </SelectItem>
                    ) : (
                      integrations.map((integration) => (
                        <SelectItem key={integration.id} value={integration.id}>
                          {integration.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="fallbackMessage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fallback Message</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="e.g. I'm sorry, I wasn't able to complete that action right now."
                    disabled={isPending}
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Vapi speaks this if the action fails
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* folder_id field: Phase 20 will add a proper folder selector UI here.
              For Phase 19, folder assignment is hidden — tools can be assigned via DB or future UI. */}

          <FormItem>
            <FormLabel>
              Labels{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </FormLabel>
            {currentLabels.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {currentLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => removeLabel(label)}
                      className="hover:text-destructive leading-none"
                      aria-label={`Remove label ${label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              placeholder="Type label, press Enter or comma"
              disabled={isPending}
              value={labelsInput}
              onChange={(e) => setLabelsInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addLabel(labelsInput)
                }
              }}
              onBlur={() => {
                if (labelsInput.trim()) addLabel(labelsInput)
              }}
            />
          </FormItem>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : mode === 'create' ? (
                'Add Tool'
              ) : (
                'Save Changes'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={onSuccess}
            >
              {mode === 'create' ? 'Back to Tools' : 'Discard Changes'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
