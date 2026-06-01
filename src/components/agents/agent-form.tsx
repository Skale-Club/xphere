'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm, FormProvider, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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

import { agentSchema, type AgentFormInput, type AgentFormOutput } from '@/lib/agents/zod-schemas'
import { slugify } from '@/lib/agents/slug'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@/lib/agents/models'
import {
  PUBLIC_AGENT_CHANNELS,
  AGENT_CHANNEL_LABELS,
  type AgentChannel,
} from '@/lib/agents/channels'
import { ToolPicker } from './tool-picker'
import { ChannelOverridesEditor } from './channel-overrides-editor'
import {
  createAgent,
  updateAgent,
  savePromptDraft,
  type ToolPickerData,
} from '@/app/(dashboard)/agents/actions'

interface AgentFormProps {
  mode: 'create' | 'edit'
  agentId?: string
  initialValues?: Partial<AgentFormInput>
  initialToolIds?: string[]
  toolPickerData: ToolPickerData
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer flex flex-row items-center justify-between space-y-0 py-3">
            <CardTitle className="text-base">{title}</CardTitle>
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

/**
 * Single-page agent CRUD form with 4 collapsible sections (D-36-02).
 *
 * - Basics: name, slug (auto from name until manually edited), description,
 *   system_prompt, model, fallback_message, is_active
 * - Generation: temperature, max_tokens, max_history (AGENT-02)
 * - Tools: tool picker (edit only | TOOL-03 deny-by-default for create mode)
 * - Channels: allowed_channels multi-select + per-channel overrides editor
 *
 * Slug auto-fills via `slugify(name)` until the user manually edits the slug
 * field, after which auto-fill stops (D-36-06).
 *
 * Partial-failure UX: if updateAgent succeeds on the row but setAgentTools
 * fails afterwards (no transaction wrapper | Plan 04 Deferred), the form
 * surfaces a recovery-oriented sonner toast.
 */
export function AgentForm({
  mode,
  agentId,
  initialValues,
  initialToolIds,
  toolPickerData,
}: AgentFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const defaultValues: AgentFormInput = {
    name: initialValues?.name ?? '',
    slug: initialValues?.slug ?? '',
    description: initialValues?.description ?? '',
    system_prompt: initialValues?.system_prompt ?? '',
    model: initialValues?.model ?? DEFAULT_MODEL,
    fallback_message:
      initialValues?.fallback_message ?? 'I cannot help with that right now.',
    max_history: initialValues?.max_history ?? 20,
    temperature: initialValues?.temperature ?? null,
    max_tokens: initialValues?.max_tokens ?? null,
    is_active: initialValues?.is_active ?? true,
    allowed_channels: initialValues?.allowed_channels ?? ['web_widget'],
    channel_overrides: initialValues?.channel_overrides ?? {},
    // TOOL-03: deny-by-default. In create mode we IGNORE initialToolIds.
    tool_ids: mode === 'create' ? [] : initialToolIds ?? [],
  }

  const form = useForm<AgentFormInput>({
    resolver: zodResolver(agentSchema),
    mode: 'onSubmit',
    defaultValues,
  })

  // ---- Auto-slug (D-36-06) ----
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

  function onSubmit(values: AgentFormInput) {
    startTransition(async () => {
      try {
        // values comes from zodResolver = AgentFormOutput shape
        const output = values as unknown as AgentFormOutput
        if (mode === 'create') {
          const result = await createAgent(output)
          if (result && 'error' in result && result.error) {
            if (result.error.includes('slug already exists')) {
              form.setError('slug', { message: result.error })
            } else {
              toast.error(result.error)
            }
            return
          }
          toast.success('Agent created.')
          if (result && 'id' in result && result.id) {
            router.push(`/agents/${result.id}`)
          } else {
            router.push('/agents')
          }
        } else {
          const result = await updateAgent(agentId!, output)
          if (result && 'error' in result && result.error) {
            if (result.error.includes('slug already exists')) {
              form.setError('slug', { message: result.error })
            } else {
              // Partial-failure UX: updateAgent succeeded on the row but
              // setAgentTools failed afterward | surface the no-transaction
              // caveat (see Plan 04 Task 1 acceptance criterion).
              // We can't distinguish reliably without an error code, so any
              // error from updateAgent gets the recovery-oriented toast.
              toast.error('Tool changes failed | please retry attaching tools on the form and save again.')
            }
            return
          }
          toast.success('Agent saved.')
          router.refresh()
        }
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
          {/* ---- Section 1: Basics ---- */}
          <CollapsibleSection title="Basics" defaultOpen>
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
                    <Textarea
                      rows={2}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="system_prompt"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>System prompt</FormLabel>
                    {mode === 'edit' && agentId && (
                      <Link
                        href={`/dashboard/agents/${agentId}/prompt-history`}
                        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-auto"
                      >
                        View history
                      </Link>
                    )}
                  </div>
                  <FormControl>
                    <Textarea rows={10} {...field} />
                  </FormControl>
                  {mode === 'edit' && agentId && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        const currentPrompt = form.getValues('system_prompt')
                        startTransition(async () => {
                          const result = await savePromptDraft(agentId, currentPrompt)
                          if ('error' in result) {
                            toast.error(result.error)
                          } else {
                            toast.success(`Draft v${result.version} saved | use Publish to make it live`)
                          }
                        })
                      }}
                    >
                      Save Draft
                    </Button>
                  )}
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
                      Toggling here saves with the rest of the form.
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
          </CollapsibleSection>

          {/* ---- Section 2: Generation ---- */}
          <CollapsibleSection title="Generation">
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
                            e.target.value === ''
                              ? null
                              : Number(e.target.value)
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
                            e.target.value === ''
                              ? null
                              : Number(e.target.value)
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
          </CollapsibleSection>

          {/* ---- Section 3: Tools ---- */}
          <CollapsibleSection title="Tools" defaultOpen={mode === 'edit'}>
            {mode === 'create' ? (
              <p className="text-sm text-muted-foreground">
                New agents start with no tools attached. After creating, open
                the agent to grant tools.
              </p>
            ) : (
              <Controller
                control={form.control}
                name="tool_ids"
                render={({ field }) => (
                  <ToolPicker
                    data={toolPickerData}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            )}
          </CollapsibleSection>

          {/* ---- Section 4: Channels ---- */}
          <CollapsibleSection title="Channels">
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
          </CollapsibleSection>

          <div className="sticky bottom-0 bg-background border-t py-3 flex flex-col gap-2">
            {mode === 'edit' && agentId && (
              <p className="text-xs text-muted-foreground">
                Saving creates a draft version.{' '}
                <Link href={`/dashboard/agents/${agentId}/prompt-history`} className="underline">
                  Publish from the history page
                </Link>{' '}
                to make it live.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push('/agents')}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? 'Saving…'
                  : mode === 'create'
                    ? 'Create agent'
                    : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </FormProvider>
  )
}
