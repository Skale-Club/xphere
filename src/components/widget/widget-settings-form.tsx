'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Bot, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  saveWidgetSettings,
  type WidgetSettingsInput,
} from '@/app/(dashboard)/widget/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { setChannelDefault } from '@/app/(dashboard)/agents/actions'

const widgetSettingsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required.')
    .max(60, 'Display name must be 60 characters or fewer.'),
  welcomeMessage: z
    .string()
    .trim()
    .min(1, 'Welcome message is required.')
    .max(280, 'Welcome message must be 280 characters or fewer.'),
  avatarUrl: z.string().trim().optional().nullable(),
})

type WidgetSettingsFormValues = z.infer<typeof widgetSettingsSchema>

interface AgentOption {
  id: string
  name: string
}

interface WidgetSettingsFormProps {
  initialSettings: WidgetSettingsInput
  widgetToken: string
  agents?: AgentOption[]
  currentAgentId?: string | null
}

export function WidgetSettingsForm({
  initialSettings,
  widgetToken,
  agents = [],
  currentAgentId = null,
}: WidgetSettingsFormProps) {
  const [agentId, setAgentId] = useState<string | null>(currentAgentId)
  const [savingAgent, setSavingAgent] = useState(false)
  const router = useRouter()
  const [savedSettings, setSavedSettings] = useState(initialSettings)
  const [isSaving, setIsSaving] = useState(false)

  async function handleAgentChange(value: string) {
    const next = value === '__none__' ? null : value
    setSavingAgent(true)
    try {
      await setChannelDefault('web_widget', next)
      setAgentId(next)
      toast.success(next ? 'Agent linked to widget.' : 'Agent unlinked from widget.')
    } catch {
      toast.error('Failed to update agent.')
    } finally {
      setSavingAgent(false)
    }
  }
  const form = useForm<WidgetSettingsFormValues>({
    resolver: zodResolver(widgetSettingsSchema),
    mode: 'onSubmit',
    defaultValues: savedSettings,
  })

  async function onSubmit(values: WidgetSettingsFormValues) {
    setIsSaving(true)

    try {
      const result = await saveWidgetSettings(values)

      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }

      if (result?.settings) {
        setSavedSettings(result.settings)
        form.reset(result.settings)
      }

      toast.success('Widget settings saved.')
      router.refresh()
    } catch {
      toast.error('Failed to save widget settings. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const isPending = isSaving

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Widget settings</CardTitle>
          <CardDescription>
            Customize the assistant name and welcome copy shown to visitors. The color is inherited from your Company info accent color.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input disabled={isPending} placeholder="AI Assistant" {...field} />
                    </FormControl>
                    <FormDescription>The widget header label visitors see.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="welcomeMessage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Welcome message</FormLabel>
                    <FormControl>
                      <Textarea
                        disabled={isPending}
                        placeholder="Hi! How can I help?"
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Shown as the first assistant message in the widget.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={isPending}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save settings'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => form.reset(savedSettings)}
                >
                  Reset
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* AI Agent */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-accent" />
            AI Agent
          </CardTitle>
          <CardDescription>
            Select the agent that handles conversations in this widget. Without an agent, the widget
            collects messages but does not auto-reply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={agentId ?? '__none__'}
            onValueChange={handleAgentChange}
            disabled={savingAgent}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Select an agent…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                <span className="text-text-tertiary">No agent (manual only)</span>
              </SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {agents.length === 0 && (
            <p className="mt-2 text-[12px] text-text-tertiary">
              No active agents found. Create an agent first in the Agents section.
            </p>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
