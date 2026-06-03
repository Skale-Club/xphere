'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Bot, Copy, Loader2, RefreshCw } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  regenerateWidgetToken,
  saveWidgetSettings,
  type WidgetSettingsInput,
} from '@/app/(dashboard)/widget/actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex color in #RRGGBB format.'),
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
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [currentToken, setCurrentToken] = useState(widgetToken)

  const form = useForm<WidgetSettingsFormValues>({
    resolver: zodResolver(widgetSettingsSchema),
    mode: 'onSubmit',
    defaultValues: savedSettings,
  })

  const embedCode = useMemo(
    () => `<script src="https://xphere.app/widget.js" data-token="${currentToken}"></script>`,
    [currentToken]
  )

  async function handleCopyEmbedCode() {
    try {
      await navigator.clipboard.writeText(embedCode)
      toast.success('Embed code copied.')
    } catch {
      toast.error('Failed to copy embed code.')
    }
  }

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

  async function handleRegenerateToken() {
    setIsRegenerating(true)

    try {
      const result = await regenerateWidgetToken()

      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }

      if (result?.widgetToken) {
        setCurrentToken(result.widgetToken)
      }

      toast.success('Widget token regenerated. Old installs are now invalid.')
      router.refresh()
    } catch {
      toast.error('Failed to regenerate widget token. Try again.')
    } finally {
      setIsRegenerating(false)
    }
  }

  const isPending = isSaving || isRegenerating

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Widget settings</CardTitle>
          <CardDescription>
            Customize the assistant name, color, and welcome copy shown to visitors.
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
                name="primaryColor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary color</FormLabel>
                    <FormControl>
                      <div className="flex gap-3">
                        <Input disabled={isPending} placeholder="#18181B" {...field} />
                        <div
                          aria-hidden="true"
                          className="h-10 w-10 shrink-0 rounded-md border"
                          style={{ backgroundColor: field.value || '#18181B' }}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>Hex only, for example #18181B.</FormDescription>
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

      <Card>
        <CardHeader>
          <CardTitle>Install snippet</CardTitle>
          <CardDescription>
            Use the canonical production widget asset with this org&apos;s current token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-6">
            <code>{embedCode}</code>
          </pre>
          <Button type="button" variant="outline" onClick={handleCopyEmbedCode}>
            <Copy className="mr-2 h-4 w-4" />
            Copy script tag
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>
            Regenerating the widget token immediately invalidates every previously installed embed
            script.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Replace the old token everywhere the widget is installed as soon as you rotate it.
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={isPending}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate token
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Regenerate widget token?</AlertDialogTitle>
                <AlertDialogDescription>
                  This change takes effect immediately. All existing embed installs using the old
                  token will stop working until they are updated.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isRegenerating}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isRegenerating}
                  onClick={(event) => {
                    event.preventDefault()
                    void handleRegenerateToken()
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isRegenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Regenerating...
                    </>
                  ) : (
                    'Regenerate token'
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
