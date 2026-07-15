'use client'

// Settings tab form (edit-only). Owns the agent's configuration EXCEPT the
// system prompt and attached tools, which live in the "Prompt & Actions"
// section. Saves via `updateAgentSettings` (never touches tools/prompt).

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

import {
  agentSettingsSchema,
  type AgentSettingsInput,
  type AgentSettingsOutput,
} from '@/lib/agents/zod-schemas'
import { slugify } from '@/lib/agents/slug'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@/lib/agents/models'
import {
  PUBLIC_AGENT_CHANNELS,
  AGENT_CHANNEL_LABELS,
  type AgentChannel,
} from '@/lib/agents/channels'
import { ChannelOverridesEditor } from './channel-overrides-editor'
import { updateAgentSettings } from '@/app/(dashboard)/agents/actions'

interface AgentSettingsFormProps {
  agentId: string
  initialValues: Partial<AgentSettingsInput>
  groups?: Array<{ id: string; name: string }>
}

export function AgentSettingsForm({
  agentId,
  initialValues,
  groups = [],
}: AgentSettingsFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const defaultValues: AgentSettingsInput = {
    name: initialValues?.name ?? '',
    slug: initialValues?.slug ?? '',
    description: initialValues?.description ?? '',
    model: initialValues?.model ?? DEFAULT_MODEL,
    fallback_message:
      initialValues?.fallback_message ?? 'I cannot help with that right now.',
    max_history: initialValues?.max_history ?? 20,
    temperature: initialValues?.temperature ?? null,
    max_tokens: initialValues?.max_tokens ?? null,
    is_active: initialValues?.is_active ?? true,
    group_id: initialValues?.group_id ?? null,
    allowed_channels: initialValues?.allowed_channels ?? ['web_widget'],
    channel_overrides: initialValues?.channel_overrides ?? {},
  }

  const form = useForm<AgentSettingsInput>({
    resolver: zodResolver(agentSettingsSchema),
    mode: 'onSubmit',
    defaultValues,
  })

  // Auto-slug until the user manually edits the slug field.
  const slugTouched = useRef(false)
  const name = form.watch('name')
  const slug = form.watch('slug')
  useEffect(() => {
    const expectedAuto = slugify(name ?? '')
    if (slug && slug !== expectedAuto && slug !== '') {
      slugTouched.current = true
    }
  }, [slug, name])
  useEffect(() => {
    if (!slugTouched.current) {
      form.setValue('slug', slugify(name ?? ''), { shouldValidate: false })
    }
  }, [name, form])

  const allowedChannels = form.watch('allowed_channels') ?? []

  function onSubmit(values: AgentSettingsInput) {
    startTransition(async () => {
      try {
        const output = values as unknown as AgentSettingsOutput
        const result = await updateAgentSettings(agentId, output)
        if (result && 'error' in result && result.error) {
          if (result.error.includes('slug already exists')) {
            form.setError('slug', { message: result.error })
          } else {
            toast.error(result.error)
          }
          return
        }
        toast.success('Settings saved.')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Unknown error')
      }
    })
  }

  function toggleChannel(ch: AgentChannel, checked: boolean) {
    const cur = form.getValues('allowed_channels') ?? []
    const next = checked
      ? [...new Set([...cur, ch])]
      : cur.filter((c) => c !== ch)
    form.setValue('allowed_channels', next, { shouldValidate: true })
  }

  return (
    <FormProvider {...form}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Tabs defaultValue="general">
            <TabsList className="w-full">
              <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
              <TabsTrigger value="generation" className="flex-1">Generation</TabsTrigger>
              <TabsTrigger value="channels" className="flex-1">Channels</TabsTrigger>
            </TabsList>

            {/* General */}
            <TabsContent value="general" className="space-y-4 mt-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Slug</FormLabel>
                    <FormControl>
                      <Input {...field} className="font-mono" />
                    </FormControl>
                    <FormDescription>
                      Lowercase letters, digits, hyphens only. Auto-fills from
                      name until you edit.
                    </FormDescription>
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
                      <Textarea rows={2} {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {AVAILABLE_MODELS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
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
                name="fallback_message"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fallback message</FormLabel>
                    <FormControl>
                      <Textarea rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <FormLabel>Active</FormLabel>
                      <FormDescription>
                        Inactive agents are hidden from Channel Defaults.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="group_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group</FormLabel>
                    <Select
                      value={field.value ?? '__none__'}
                      onValueChange={(v) => field.onChange(v === '__none__' ? null : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No group" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">No group</SelectItem>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Organizes the agent in the sidebar. You can also drag it between groups.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </TabsContent>

            {/* Generation */}
            <TabsContent value="generation" className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="temperature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Temperature</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === '' ? null : Number(e.target.value)
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>0..2 · empty = SDK default</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="max_tokens"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max tokens</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === '' ? null : Number(e.target.value)
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>empty = 1024</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="max_history"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max history (turns)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          value={field.value}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            {/* Channels */}
            <TabsContent value="channels" className="space-y-4 mt-4">
              <div>
                <Label className="mb-2 block">Allowed channels</Label>
                <div className="flex flex-wrap gap-2">
                  {PUBLIC_AGENT_CHANNELS.map((ch) => {
                    const checked = allowedChannels.includes(ch)
                    return (
                      <label
                        key={ch}
                        className="flex items-center gap-2 rounded-md border px-2 py-1 cursor-pointer text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleChannel(ch, v === true)}
                        />
                        <span>{AGENT_CHANNEL_LABELS[ch]}</span>
                      </label>
                    )
                  })}
                </div>
                {form.formState.errors.allowed_channels && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.allowed_channels.message as string}
                  </p>
                )}
              </div>
              <div>
                <Label className="mb-2 block">Channel overrides</Label>
                <ChannelOverridesEditor
                  allowedChannels={allowedChannels as AgentChannel[]}
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Lifted clear of the Copilot launcher pinned bottom-right | at narrow
              widths this column reaches the launcher and would bury the button. */}
          <div className="sticky bottom-24 bg-background border-t py-3 flex justify-end gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </form>
      </Form>
    </FormProvider>
  )
}
