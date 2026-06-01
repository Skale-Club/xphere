'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { IntegrationForDisplay } from '@/app/(dashboard)/integrations/actions'
import {
  createIntegration,
  updateIntegration,
  deleteIntegration,
} from '@/app/(dashboard)/integrations/actions'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

type Provider = IntegrationForDisplay['provider']

const PROVIDER_LABELS: Record<Provider, string> = {
  gohighlevel: 'GoHighLevel',
  twilio: 'Twilio',
  calcom: 'Cal.com',
  custom_webhook: 'Custom Webhook',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  vapi: 'Vapi',
  manychat: 'ManyChat',
  google_contacts: 'Google Contacts',
  google_calendar: 'Google Calendar',
  telegram: 'Telegram',
  resend: 'Resend',
  zernio: 'Zernio',
}

const integrationSchema = z.object({
  apiKey: z.string(),
  locationId: z.string().optional(),
  defaultModel: z.string().optional(),
})

type IntegrationFormValues = z.infer<typeof integrationSchema>

interface IntegrationFormProps {
  provider: Provider
  integration?: IntegrationForDisplay
  onSuccess: () => void
}

export function IntegrationForm({ provider, integration, onSuccess }: IntegrationFormProps) {
  const [isPending, setIsPending] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const mode = integration ? 'edit' : 'create'

  const form = useForm<IntegrationFormValues>({
    resolver: zodResolver(integrationSchema),
    mode: 'onSubmit',
    defaultValues: {
      apiKey: '',
      locationId: integration?.location_id ?? '',
      defaultModel: (integration?.config as Record<string, string> | null)?.model ?? '',
    },
  })

  async function onSubmit(values: IntegrationFormValues) {
    if (mode === 'create' && !values.apiKey.trim()) {
      form.setError('apiKey', { message: 'API key is required' })
      return
    }

    setIsPending(true)
    try {
      const config: Record<string, string> = {}
      if (values.defaultModel?.trim()) {
        config.model = values.defaultModel.trim()
      }

      const name = PROVIDER_LABELS[provider]
      let result: { error?: string } | void

      if (mode === 'create') {
        result = await createIntegration({
          name,
          provider,
          apiKey: values.apiKey,
          locationId: values.locationId ?? '',
          config,
        })
      } else {
        if (!integration) return
        result = await updateIntegration(integration.id, {
          name,
          locationId: values.locationId ?? '',
          config,
          apiKey: values.apiKey.trim().length > 0 ? values.apiKey : undefined,
        })
      }

      if (result && 'error' in result && result.error) {
        toast.error(`Failed to save integration: ${result.error}`)
        return
      }

      toast.success('Integration saved.')
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to save integration: ${msg}`)
    } finally {
      setIsPending(false)
    }
  }

  async function handleDisconnect() {
    if (!integration) return
    setIsDeleting(true)
    try {
      const result = await deleteIntegration(integration.id)
      if (result && 'error' in result && result.error) {
        toast.error('Failed to disconnect. Try again.')
      } else {
        toast.success('Integration disconnected.')
        onSuccess()
      }
    } catch {
      toast.error('Failed to disconnect. Try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">
          {PROVIDER_LABELS[provider]}
        </p>
        <h2 className="text-xl font-semibold">
          {mode === 'create' ? 'Connect' : 'Update credentials'}
        </h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  API Key{mode === 'edit' && ' (leave blank to keep existing)'}
                </FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder={mode === 'edit' ? '••••••••••••••••' : 'Enter API key'}
                    disabled={isPending || isDeleting}
                    autoComplete="new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {provider === 'gohighlevel' && (
            <FormField
              control={form.control}
              name="locationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location ID</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="GHL Location ID"
                      disabled={isPending || isDeleting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {provider === 'openrouter' && (
            <FormField
              control={form.control}
              name="defaultModel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Model (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="anthropic/claude-haiku-4-5"
                      disabled={isPending || isDeleting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isPending || isDeleting}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : mode === 'create' ? (
                'Connect'
              ) : (
                'Save Changes'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending || isDeleting}
              onClick={onSuccess}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Form>

      {mode === 'edit' && (
        <div className="border-t pt-6">
          <Button
            variant="ghost"
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            disabled={isPending || isDeleting}
            onClick={handleDisconnect}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Disconnecting...
              </>
            ) : (
              'Disconnect'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
