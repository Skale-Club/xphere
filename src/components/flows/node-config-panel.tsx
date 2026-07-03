'use client'

import { forwardRef, useEffect, useState, type ButtonHTMLAttributes } from 'react'
import { toast } from 'sonner'
import { Braces, Check, ChevronDown, SendHorizontal, Trash2, User, X } from 'lucide-react'
import { testSendSms } from '@/app/(dashboard)/integrations/twilio/actions'
import { testSendTelegramNotification } from '@/app/(dashboard)/integrations/telegram/actions'
import { interpolate } from '@/lib/flows/interpolate'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

// ── Inline icon badge — coloured bg + white inner layer for brand logos ────────

function NodeIconBadge({
  icon: Icon,
  iconClass,
  logo,
  size = 'sm',
}: {
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  logo?: string
  size?: 'sm' | 'xs'
}) {
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = !!logo && !logoFailed

  const outerSize = size === 'sm' ? 'h-5 w-5' : 'h-4 w-4'
  const outerRadius = size === 'sm' ? 'rounded-[5px]' : 'rounded-[4px]'
  const innerSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-3 w-3'
  const imgSize = size === 'sm' ? 10 : 8
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-2.5 w-2.5'

  return (
    <span className={`inline-flex ${outerSize} items-center justify-center ${outerRadius} ${iconClass}`}>
      {showLogo ? (
        <span className={`inline-flex ${innerSize} items-center justify-center rounded-[3px] bg-white overflow-hidden`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logo}
            alt=""
            width={imgSize}
            height={imgSize}
            className="object-contain"
            onError={() => setLogoFailed(true)}
          />
        </span>
      ) : (
        <Icon className={iconSize} />
      )}
    </span>
  )
}
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useFlowStore } from '@/stores/flow-store'
import {
  filterActions,
  filterTriggers,
  getActionMetadata,
  getTriggerMetadata,
  groupedActions,
  groupedTriggers,
  type IntegrationKey,
} from '@/lib/flows/node-metadata'
import {
  appendVariableToken,
  variablesForTrigger,
  type VariableGroup,
} from '@/lib/flows/variables'
import { cn } from '@/lib/utils'

const NODE_TYPE_LABEL: Record<string, string> = {
  trigger: 'Trigger',
  action: 'Action',
  condition: 'Condition',
  wait: 'Wait',
  agent: 'Agent',
  end: 'End',
}

const DURATION_UNITS = [
  { value: 'm', label: 'Minutes' },
  { value: 'h', label: 'Hours' },
  { value: 'd', label: 'Days' },
  { value: 'w', label: 'Weeks' },
] as const

type DurationUnit = (typeof DURATION_UNITS)[number]['value']

// Sensible per-unit caps so people can't enter 25h / 61min — they should pick the
// next unit up. The boundary value is allowed (24h, 60min) so "24h before" works.
const UNIT_MAX: Record<DurationUnit, number> = { m: 60, h: 24, d: 31, w: 52 }

// Friendly cron presets so the schedule isn't a raw cron string by default.
const CRON_PRESETS = [
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 9 * * *', label: 'Every day at 9 AM' },
  { value: '0 9 * * 1', label: 'Every Monday at 9 AM' },
  { value: '0 9 1 * *', label: 'Monthly (1st at 9 AM)' },
] as const

function parseDurationValue(value: string | undefined, fallback: string): {
  amount: string
  unit: DurationUnit
} {
  const match = (value ?? fallback).trim().toLowerCase().match(/^(\d+)\s*([mhdw])$/)
  if (!match) {
    const fallbackMatch = fallback.match(/^(\d+)([mhdw])$/)
    return {
      amount: fallbackMatch?.[1] ?? '1',
      unit: (fallbackMatch?.[2] as DurationUnit | undefined) ?? 'h',
    }
  }

  return {
    amount: match[1],
    unit: match[2] as DurationUnit,
  }
}

function toDurationValue(amount: string, unit: DurationUnit): string {
  const max = UNIT_MAX[unit] ?? Infinity
  const safeAmount = Math.min(max, Math.max(1, Number(amount) || 1))
  return `${safeAmount}${unit}`
}

interface AgentOption {
  id: string
  name: string
  slug: string
}

type FlowPickerData = import('@/app/(dashboard)/workflows/flows/_actions/picker-data').FlowPickerData

const EMPTY_PICKER_DATA: FlowPickerData = { templates: [], stages: [], members: [], numbers: [], flows: [] }

interface NodeConfigPanelProps {
  activeIntegrations: IntegrationKey[]
  agents?: AgentOption[]
  pickerData?: FlowPickerData
}

export function NodeConfigPanel({ activeIntegrations, agents = [], pickerData = EMPTY_PICKER_DATA }: NodeConfigPanelProps) {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId)
  const node = useFlowStore((s) =>
    selectedNodeId ? s.nodes.find((n) => n.id === selectedNodeId) ?? null : null,
  )
  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const removeNode = useFlowStore((s) => s.removeNode)
  const setSelected = useFlowStore((s) => s.setSelected)
  // Trigger event_type drives which dynamic variables are in scope at action nodes.
  const triggerEventType = useFlowStore((s) => {
    const t = s.nodes.find((n) => n.data.flowData.kind === 'trigger')
    return t && t.data.flowData.kind === 'trigger' ? t.data.flowData.event_type : undefined
  })

  if (!node) {
    return (
      <div className="w-72 border-l border-border bg-card shrink-0 flex flex-col">
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          Select a node to configure it.
        </div>
      </div>
    )
  }

  const flow = node.data.flowData
  const activeSet = new Set(activeIntegrations)

  // Compute friendly title + type subtitle (Item 12)
  let friendlyTitle = flow.label
  if (flow.kind === 'trigger') {
    const meta = getTriggerMetadata(flow.event_type)
    if (meta) friendlyTitle = meta.label
  } else if (flow.kind === 'action') {
    const meta = getActionMetadata(flow.action_type)
    if (meta) friendlyTitle = meta.label
  }

  return (
    <div className="w-80 border-l border-border bg-card shrink-0 flex flex-col">
      {/* Header | friendly title + type subtitle */}
      <div className="flex items-start justify-between px-3 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{friendlyTitle}</p>
          <p className="text-[10.5px] uppercase tracking-wider text-text-tertiary mt-0.5">
            {NODE_TYPE_LABEL[node.type ?? 'action'] ?? 'Node'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => removeNode(node.id)}
            title="Delete node"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setSelected(null)}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Label */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-text-tertiary">Label</Label>
          <Input
            value={flow.label}
            onChange={(e) => updateNodeData(node.id, { label: e.target.value } as Partial<typeof flow>)}
            className="h-8 text-xs"
            placeholder="Friendly name for this step"
          />
        </div>

        {flow.kind === 'trigger' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Event</Label>
              <TriggerPicker
                value={flow.event_type}
                activeSet={activeSet}
                onChange={(v) => updateNodeData(node.id, { event_type: v })}
              />
              {getTriggerMetadata(flow.event_type)?.description && (
                <p className="text-[10.5px] text-text-tertiary">
                  {getTriggerMetadata(flow.event_type)!.description}
                </p>
              )}
            </div>
            {flow.event_type === 'cron' && (() => {
              const cron = flow.schedule_cron ?? ''
              const preset = CRON_PRESETS.find((p) => p.value === cron)
              const sel = cron === '' ? '' : preset ? cron : '__custom__'
              return (
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-text-tertiary">Schedule</Label>
                  <Select
                    value={sel || undefined}
                    onValueChange={(v) =>
                      updateNodeData(node.id, {
                        schedule_cron: v === '__custom__' ? (preset ? '' : cron) : v,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="How often?" /></SelectTrigger>
                    <SelectContent>
                      {CRON_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                      ))}
                      <SelectItem value="__custom__" className="text-xs">Custom cron…</SelectItem>
                    </SelectContent>
                  </Select>
                  {sel === '__custom__' && (
                    <>
                      <Input
                        value={cron}
                        onChange={(e) => updateNodeData(node.id, { schedule_cron: e.target.value })}
                        placeholder="0 9 * * 1"
                        className="h-8 text-xs font-mono"
                      />
                      <p className="text-[10.5px] text-text-tertiary">
                        Cron format: <code>min hour day month weekday</code> — e.g. <code>0 9 * * 1</code> = Mon 9 AM.
                      </p>
                    </>
                  )}
                </div>
              )
            })()}
          </>
        )}

        {flow.kind === 'action' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Action</Label>
              <ActionPicker
                value={flow.action_type}
                activeSet={activeSet}
                onChange={(v) => updateNodeData(node.id, { action_type: v, config: {} })}
              />
              {getActionMetadata(flow.action_type)?.description && (
                <p className="text-[10.5px] text-text-tertiary">
                  {getActionMetadata(flow.action_type)!.description}
                </p>
              )}
            </div>

            {/* User-friendly action configuration */}
            <ActionConfigFields
              actionType={flow.action_type}
              config={flow.config ?? {}}
              variables={variablesForTrigger(triggerEventType)}
              pickerData={pickerData}
              onChange={(patch) =>
                updateNodeData(node.id, { config: { ...(flow.config ?? {}), ...patch } })
              }
            />
          </>
        )}

        {flow.kind === 'condition' && (
          <div className="space-y-1.5">
            <VarTextareaField
              label="Condition"
              value={flow.expression}
              onChange={(v) => updateNodeData(node.id, { expression: v })}
              rows={3}
              placeholder="{{opportunity.value}} > 100"
              variables={variablesForTrigger(triggerEventType)}
              mono
            />
            <p className="text-[10.5px] leading-snug text-text-tertiary">
              Insert a field with the <strong>Variable</strong> button, then compare it
              (e.g. <code>{'{{contact.email}}'} != &quot;&quot;</code>). True → green path, false → red.
            </p>
          </div>
        )}

        {flow.kind === 'wait' && (
          (() => {
            // The schema stores mode ∈ {sleep, wait_for_event}; a sleep with an
            // `until` anchor is the "wait until a time" UX. Derive a 3-way mode.
            const waitMode: 'duration' | 'until' | 'event' =
              flow.mode === 'wait_for_event' ? 'event' : flow.until ? 'until' : 'duration'
            return (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-text-tertiary">Mode</Label>
                  <Select
                    value={waitMode}
                    onValueChange={(v) => {
                      if (v === 'duration') {
                        updateNodeData(node.id, { mode: 'sleep', until: undefined, offset: undefined, duration: flow.duration ?? '1h' })
                      } else if (v === 'until') {
                        updateNodeData(node.id, { mode: 'sleep', until: flow.until || '{{meeting.starts_at}}', offset: flow.offset ?? '-24h' })
                      } else {
                        updateNodeData(node.id, { mode: 'wait_for_event', until: undefined, timeout: flow.timeout ?? '7d' })
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="duration" className="text-xs">Sleep (fixed duration)</SelectItem>
                      <SelectItem value="until" className="text-xs">Wait until a time (e.g. before a meeting)</SelectItem>
                      <SelectItem value="event" className="text-xs">Wait for event</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {waitMode === 'duration' && (
                  <DurationField
                    label="Duration"
                    value={flow.duration}
                    fallback="1h"
                    onChange={(duration) => updateNodeData(node.id, { duration })}
                  />
                )}

                {waitMode === 'until' && (() => {
                  // Offer the date/time variables in scope as a dropdown so the
                  // operator picks "Starts at" instead of typing {{meeting.starts_at}}.
                  const dateVars = variablesForTrigger(triggerEventType)
                    .flatMap((g) => g.items.map((it) => ({ ...it, group: g.label })))
                    .filter((it) => /(_at$|date|time)/i.test(it.token))
                  const until = flow.until ?? ''
                  const matched = dateVars.find((d) => `{{${d.token}}}` === until)
                  const selectValue = until === '' ? '' : matched ? `{{${matched.token}}}` : '__custom__'
                  return (
                    <div className="space-y-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] text-text-tertiary">Anchor time</Label>
                        <Select
                          value={selectValue || undefined}
                          onValueChange={(v) =>
                            updateNodeData(node.id, { until: v === '__custom__' ? (matched ? '' : until) : v })
                          }
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Choose a date/time" />
                          </SelectTrigger>
                          <SelectContent>
                            {dateVars.map((d) => (
                              <SelectItem key={d.token} value={`{{${d.token}}}`} className="text-xs">
                                {d.group} · {d.label}
                              </SelectItem>
                            ))}
                            <SelectItem value="__custom__" className="text-xs">Custom…</SelectItem>
                          </SelectContent>
                        </Select>
                        {selectValue === '__custom__' && (
                          <Input
                            value={until}
                            placeholder="ISO date or {{variable}}"
                            onChange={(e) => updateNodeData(node.id, { until: e.target.value })}
                            className="h-8 text-xs font-mono"
                          />
                        )}
                      </div>
                      <OffsetField
                        label="Offset"
                        value={flow.offset}
                        fallback="-24h"
                        onChange={(offset) => updateNodeData(node.id, { offset })}
                      />
                      <p className="text-[10.5px] leading-snug text-text-tertiary">
                        Resumes at the chosen time shifted by the offset. For a “24h before the meeting”
                        reminder, pick <strong>Starts at</strong> and offset 24 hours <strong>before</strong>.
                      </p>
                    </div>
                  )
                })()}

                {waitMode === 'event' && (
                  <div className="space-y-2">
                    <DurationField
                      label="Timeout"
                      value={flow.timeout}
                      fallback="7d"
                      onChange={(timeout) => updateNodeData(node.id, { timeout })}
                    />
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-text-tertiary">Event Type</Label>
                      <Select
                        value={flow.event_type ?? ''}
                        onValueChange={(v) => updateNodeData(node.id, { event_type: v })}
                      >
                        <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select event..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="meeting.confirmed" className="text-xs">Meeting confirmed</SelectItem>
                          <SelectItem value="meeting.cancelled" className="text-xs">Meeting cancelled</SelectItem>
                          <SelectItem value="meeting.completed" className="text-xs">Meeting completed</SelectItem>
                          <SelectItem value="meeting.no_show" className="text-xs">Meeting no-show</SelectItem>
                          <SelectItem value="meeting.rescheduled" className="text-xs">Meeting rescheduled</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[10.5px] leading-snug text-text-tertiary">
                        Waits for this event <strong>for the contact of this flow</strong>. If the
                        timeout passes first, the flow continues, flagged as timed out.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )
          })()
        )}

        {flow.kind === 'agent' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Agent</Label>
              <Select
                value={flow.agent_id ?? '__default__'}
                onValueChange={(v) =>
                  updateNodeData(node.id, { agent_id: v === '__default__' ? '' : v })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Default agent</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agents.length === 0 && (
                <p className="text-[10.5px] text-text-tertiary">
                  No active agents yet — create one under Agents.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Input</Label>
              <Textarea
                value={flow.input ?? ''}
                onChange={(e) => updateNodeData(node.id, { input: e.target.value })}
                rows={3}
                placeholder="What the agent should process, e.g. {{trigger.payload.message}}"
                className="text-xs resize-none"
              />
              <p className="text-[10.5px] text-text-tertiary">
                The message/objective the agent receives. Supports {`{{variables}}`} from the trigger and prior steps.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Instructions (optional)</Label>
              <Textarea
                value={flow.system_prompt}
                onChange={(e) => updateNodeData(node.id, { system_prompt: e.target.value })}
                rows={3}
                placeholder="Extra guidance for this step (added to the agent's own prompt)."
                className="text-xs resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Max steps</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={flow.max_steps}
                onChange={(e) => updateNodeData(node.id, { max_steps: Number(e.target.value) || 10 })}
                className="h-8 text-xs"
              />
            </div>

            <p className="text-[10.5px] text-text-tertiary border-t border-border-subtle pt-2">
              Output available downstream as{' '}
              <code className="text-accent">{`{{steps.${node.id}.output.agent_response}}`}</code>
            </p>
          </>
        )}

        {flow.kind === 'end' && (
          <p className="text-xs text-muted-foreground">
            Terminates this branch of the flow. No configuration needed.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Shared picker button ──────────────────────────────────────────────────────

interface PickerTriggerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  open: boolean
  icon?: React.ComponentType<{ className?: string }>
  iconClass?: string
  logo?: string
  label?: string
  subtitle?: string
  placeholder: string
}

// forwardRef + prop spread are REQUIRED: PopoverTrigger uses `asChild` (Radix
// Slot), which clones this element and injects onClick/ref/aria. Without
// forwarding them to the underlying <button>, the popover never opens.
const PickerTriggerButton = forwardRef<HTMLButtonElement, PickerTriggerButtonProps>(
  function PickerTriggerButton(
    { open, icon, iconClass, logo, label, subtitle, placeholder, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={open}
        {...rest}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors"
      >
        {icon && iconClass ? (
          <NodeIconBadge icon={icon} iconClass={iconClass} logo={logo} />
        ) : null}
        <span className={cn('flex-1 truncate text-left', !label && 'text-muted-foreground')}>
          {label ?? placeholder}
        </span>
        {subtitle && (
          <span className="shrink-0 text-[10px] text-muted-foreground">{subtitle}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
    )
  },
)

// ── TriggerPicker ─────────────────────────────────────────────────────────────

function TriggerPicker({
  value,
  activeSet,
  onChange,
}: {
  value: string
  activeSet: Set<IntegrationKey>
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = getTriggerMetadata(value)
  const groups = groupedTriggers(activeSet)
  const isDisconnected = !!value && !filterTriggers(activeSet).some((m) => m.key === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTriggerButton
          open={open}
          icon={selected?.icon}
          iconClass={selected?.iconClass}
          logo={selected?.logo}
          label={isDisconnected ? `${selected?.label ?? value} · disconnected` : selected?.label}
          subtitle={selected?.subtitle}
          placeholder="Choose a trigger…"
        />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="bottom">
        <Command>
          <CommandInput placeholder="Search triggers…" className="h-8 text-xs" />
          <CommandList className="max-h-72">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No trigger found.
            </CommandEmpty>
            {groups.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-muted-foreground">
                No triggers available — connect an integration first.
              </div>
            )}
            {groups.map((g) => (
              <CommandGroup key={g.label} heading={g.label}>
                {g.items.map((m) => (
                  <CommandItem
                    key={m.key}
                    value={`${m.label} ${m.subtitle ?? ''} ${g.label}`}
                    onSelect={() => { onChange(m.key); setOpen(false) }}
                    className="flex items-center gap-2 text-xs py-1.5"
                  >
                    <NodeIconBadge icon={m.icon} iconClass={m.iconClass} logo={m.logo} />
                    <span className="flex-1 truncate">{m.label}</span>
                    {m.subtitle && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">{m.subtitle}</span>
                    )}
                    {value === m.key && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {/* Disconnected fallback — shows if current value isn't in the active list */}
            {isDisconnected && selected && (
              <CommandGroup heading="Disconnected">
                <CommandItem
                  value={value}
                  onSelect={() => { onChange(value); setOpen(false) }}
                  className="flex items-center gap-2 text-xs py-1.5 opacity-60"
                >
                  <NodeIconBadge icon={selected.icon} iconClass={selected.iconClass} logo={selected.logo} />
                  <span className="flex-1 truncate">{selected.label}</span>
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ── ActionPicker ──────────────────────────────────────────────────────────────

function ActionPicker({
  value,
  activeSet,
  onChange,
}: {
  value: string
  activeSet: Set<IntegrationKey>
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = getActionMetadata(value)
  const groups = groupedActions(activeSet)
  const isDisconnected = !!value && !filterActions(activeSet).some((m) => m.key === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTriggerButton
          open={open}
          icon={selected?.icon}
          iconClass={selected?.iconClass}
          logo={selected?.logo}
          label={isDisconnected ? `${selected?.label ?? value} · disconnected` : selected?.label}
          subtitle={selected?.subtitle}
          placeholder="Choose an action…"
        />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="bottom">
        <Command>
          <CommandInput placeholder="Search actions…" className="h-8 text-xs" />
          <CommandList className="max-h-72">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No action found.
            </CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.label} heading={g.label}>
                {g.items.map((m) => (
                  <CommandItem
                    key={m.key}
                    value={`${m.label} ${m.subtitle ?? ''} ${g.label}`}
                    onSelect={() => { onChange(m.key); setOpen(false) }}
                    className="flex items-center gap-2 text-xs py-1.5"
                  >
                    <NodeIconBadge icon={m.icon} iconClass={m.iconClass} logo={m.logo} />
                    <span className="flex-1 truncate">{m.label}</span>
                    {m.subtitle && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">{m.subtitle}</span>
                    )}
                    {value === m.key && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {isDisconnected && selected && (
              <CommandGroup heading="Disconnected">
                <CommandItem
                  value={value}
                  onSelect={() => { onChange(value); setOpen(false) }}
                  className="flex items-center gap-2 text-xs py-1.5 opacity-60"
                >
                  <NodeIconBadge icon={selected.icon} iconClass={selected.iconClass} logo={selected.logo} />
                  <span className="flex-1 truncate">{selected.label}</span>
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function DurationField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string
  value?: string
  fallback: string
  onChange: (value: string) => void
}) {
  const parsed = parseDurationValue(value, fallback)

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-text-tertiary">{label}</Label>
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Input
          type="number"
          min={1}
          max={UNIT_MAX[parsed.unit]}
          step={1}
          value={parsed.amount}
          onChange={(e) => onChange(toDurationValue(e.target.value, parsed.unit))}
          className="h-8 text-xs"
        />
        <Select
          value={parsed.unit}
          onValueChange={(unit) => onChange(toDurationValue(parsed.amount, unit as DurationUnit))}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_UNITS.map((unit) => (
              <SelectItem key={unit.value} value={unit.value} className="text-xs">
                {unit.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// Signed offset relative to an anchor time: magnitude + unit + before/after.
// Serializes to "-24h" (before) or "24h" (after) — consumed by the wait engine.
function OffsetField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string
  value?: string
  fallback: string
  onChange: (value: string) => void
}) {
  const raw = (value ?? fallback).trim()
  const direction = raw.startsWith('-') ? 'before' : 'after'
  const parsed = parseDurationValue(raw.replace(/^[-+]/, ''), fallback.replace(/^[-+]/, ''))
  const write = (amount: string, unit: DurationUnit, dir: string) => {
    const body = toDurationValue(amount, unit)
    onChange(dir === 'before' ? `-${body}` : body)
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-text-tertiary">{label}</Label>
      <div className="grid grid-cols-[1fr_110px_110px] gap-2">
        <Input
          type="number"
          min={1}
          max={UNIT_MAX[parsed.unit]}
          step={1}
          value={parsed.amount}
          onChange={(e) => write(e.target.value, parsed.unit, direction)}
          className="h-8 text-xs"
        />
        <Select value={parsed.unit} onValueChange={(u) => write(parsed.amount, u as DurationUnit, direction)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DURATION_UNITS.map((unit) => (
              <SelectItem key={unit.value} value={unit.value} className="text-xs">{unit.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={direction} onValueChange={(d) => write(parsed.amount, parsed.unit, d)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="before" className="text-xs">before</SelectItem>
            <SelectItem value="after" className="text-xs">after</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// ── Variable picker — inserts {{token}} into a field ──────────────────────────

function VariablePicker({
  variables,
  onInsert,
}: {
  variables: VariableGroup[]
  onInsert: (token: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (variables.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Insert a dynamic field"
          className="flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
        >
          <Braces className="h-3 w-3" />
          Variable
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end" side="bottom">
        <Command>
          <CommandInput placeholder="Search fields…" className="h-8 text-xs" />
          <CommandList className="max-h-64">
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
              No field found.
            </CommandEmpty>
            {variables.map((g) => (
              <CommandGroup key={g.label} heading={g.label}>
                {g.items.map((it) => (
                  <CommandItem
                    key={it.token}
                    value={`${it.label} ${it.token}`}
                    onSelect={() => { onInsert(it.token); setOpen(false) }}
                    className="flex items-center justify-between gap-2 text-xs py-1.5"
                  >
                    <span className="truncate">{it.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
                      {`{{${it.token}}}`}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function FieldLabelRow({
  label,
  variables,
  onInsert,
}: {
  label: string
  variables: VariableGroup[]
  onInsert: (token: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-[11px] text-text-tertiary">{label}</Label>
      <VariablePicker variables={variables} onInsert={onInsert} />
    </div>
  )
}

function VarField({
  label,
  value,
  onChange,
  placeholder,
  variables,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  variables: VariableGroup[]
  mono?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabelRow label={label} variables={variables} onInsert={(t) => onChange(appendVariableToken(value, t))} />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('h-8 text-xs', mono && 'font-mono')}
      />
    </div>
  )
}

function VarTextareaField({
  label,
  value,
  onChange,
  placeholder,
  variables,
  rows = 2,
  mono = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  variables: VariableGroup[]
  rows?: number
  mono?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabelRow label={label} variables={variables} onInsert={(t) => onChange(appendVariableToken(value, t))} />
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={cn('text-xs resize-none', mono && 'font-mono')}
        placeholder={placeholder}
      />
    </div>
  )
}

interface ActionConfigFieldsProps {
  actionType: string
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
  /** Dynamic fields available at this node, derived from the flow's trigger. */
  variables: VariableGroup[]
  /** Option lists for name-pickers (templates, stages, users, numbers). */
  pickerData: FlowPickerData
}

// A dropdown of named options with a "Custom…" escape hatch that reveals a
// variable-aware text field — so an ID can be picked by name OR set to a
// {{variable}}. Used for template / stage / user / phone-number fields.
function PickerOrCustomField({
  label,
  value,
  onChange,
  options,
  variables,
  placeholder,
  optional = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: FlowPickerData['templates']
  variables: VariableGroup[]
  placeholder?: string
  optional?: boolean
}) {
  const matched = options.find((o) => o.value === value)
  const sel = value === '' ? '' : matched ? value : '__custom__'
  const noneVal = '__none__'
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-text-tertiary">{label}</Label>
      <Select
        value={sel || (optional ? noneVal : undefined)}
        onValueChange={(v) => {
          if (v === noneVal) onChange('')
          else if (v === '__custom__') onChange(matched ? '' : value)
          else onChange(v)
        }}
      >
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value={noneVal} className="text-xs">— None —</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
          ))}
          <SelectItem value="__custom__" className="text-xs">Custom / variable…</SelectItem>
        </SelectContent>
      </Select>
      {sel === '__custom__' && (
        <VarField label="" value={value} onChange={onChange} placeholder={placeholder} variables={variables} mono />
      )}
    </div>
  )
}

// Shared "link to a record" controls for create_task / create_note: entity type
// (enum) + entity id (variable-aware). The id is usually a {{variable}} from the
// trigger (e.g. {{contact.id}}, {{opportunity.id}}).
function EntityLinkFields({
  get,
  onChange,
  variables,
}: {
  get: (key: string) => string
  onChange: (patch: Record<string, unknown>) => void
  variables: VariableGroup[]
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-[11px] text-text-tertiary">Link to (optional)</Label>
        <Select
          value={get('entity_type') || '__none__'}
          onValueChange={(v) => onChange({ entity_type: v === '__none__' ? '' : v })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">Nothing</SelectItem>
            <SelectItem value="contact" className="text-xs">Contact</SelectItem>
            <SelectItem value="account" className="text-xs">Account</SelectItem>
            <SelectItem value="opportunity" className="text-xs">Opportunity</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {get('entity_type') && (
        <VarField
          label="Record ID"
          value={get('entity_id')}
          onChange={(v) => onChange({ entity_id: v })}
          placeholder="{{contact.id}}"
          variables={variables}
          mono
        />
      )}
    </>
  )
}

// ── Test-send rows — fire the action right now, independent of the saved
// config, so an operator can confirm credentials/formatting actually work
// without running the whole flow. Never persists anything to node config. ──

// Some contact records only have `name` filled in, not the split
// `first_name`/`last_name` columns. Derive them for the test preview so
// {{contact.first_name}} still resolves instead of rendering blank.
function withNameFallbacks(contact: Record<string, unknown>): Record<string, unknown> {
  const name = typeof contact.name === 'string' ? contact.name.trim() : ''
  const parts = name.split(/\s+/).filter(Boolean)
  return {
    ...contact,
    first_name: contact.first_name || parts[0] || '',
    last_name: contact.last_name || parts.slice(1).join(' ') || '',
    name: contact.name || [contact.first_name, contact.last_name].filter(Boolean).join(' '),
  }
}

function TestSendSmsRow({
  to,
  body,
  phoneNumberId,
}: {
  to: string
  body: string
  phoneNumberId?: string
}) {
  const isTemplate = to.includes('{{')
  const [dest, setDest] = useState(isTemplate ? '' : to)
  const [running, setRunning] = useState(false)
  const [contact, setContact] = useState<Record<string, unknown> | null>(null)

  // Best-effort: if the test number matches an existing contact, fetch their
  // record so the send below can substitute {{contact.*}} placeholders with
  // real data instead of sending the literal template.
  useEffect(() => {
    const phone = dest.trim()
    if (phone.length < 6) {
      setContact(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      fetch(`/api/voice/contact-by-phone?phone=${encodeURIComponent(phone)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { contact?: Record<string, unknown> | null } | null) => {
          if (!cancelled) setContact(data?.contact ?? null)
        })
        .catch(() => undefined)
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [dest])

  // Only substitute when a real contact matched — otherwise leave the
  // {{tokens}} visible rather than silently blanking them out.
  const effectiveBody = contact
    ? (interpolate(body, { contact: withNameFallbacks(contact) }) as string)
    : body

  async function run() {
    const destination = dest.trim()
    if (!destination) {
      toast.error('Enter a real phone number to test with.')
      return
    }
    setRunning(true)
    try {
      const res = await testSendSms({
        to: destination,
        body: effectiveBody.trim() || undefined,
        fromNumberId: phoneNumberId?.trim() || undefined,
      })
      if (res.success) {
        const who = contact?.name ? ` to ${String(contact.name)}` : ''
        toast.success(`Test SMS sent${who} · SID ${res.sid}`)
      } else {
        toast.error(res.error ?? 'Test failed')
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-1.5 rounded-[8px] border border-border-subtle bg-bg-tertiary/40 p-2.5">
      <Label className="text-[11px] text-text-tertiary">Test this action</Label>
      <div className="flex gap-1.5">
        <Input
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="+14155551234"
          className="h-8 flex-1 text-xs font-mono"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 gap-1 text-xs"
          onClick={run}
          loading={running}
          disabled={running}
        >
          <SendHorizontal className="h-3.5 w-3.5" />
          Send test
        </Button>
      </div>
      {contact && (
        <div className="space-y-1 rounded-[6px] bg-emerald-500/10 px-2 py-1.5">
          <p className="flex items-center gap-1 text-[10.5px] text-emerald-400">
            <User className="h-3 w-3" />
            Sending to <strong className="font-medium">{String(contact.name ?? 'Unnamed')}</strong>
          </p>
          <p className="text-[10.5px] text-text-secondary">
            <span className="italic">&quot;{effectiveBody || '(empty message)'}&quot;</span>
          </p>
        </div>
      )}
      <p className="text-[10.5px] text-text-tertiary">
        Sends the message above right now to the number entered here — a real send, not a simulation.
        {contact && ' {{contact.*}} placeholders are filled in with this contact’s data.'}
      </p>
    </div>
  )
}

function TestSendTelegramRow({
  text,
  chatId,
  parseMode,
}: {
  text: string
  chatId: string
  parseMode: string
}) {
  const [override, setOverride] = useState(chatId)
  const [running, setRunning] = useState(false)

  async function run() {
    if (!text.trim()) {
      toast.error('Write a message first.')
      return
    }
    setRunning(true)
    try {
      const res = await testSendTelegramNotification({
        text,
        chatId: override.trim() || undefined,
        parseMode: parseMode || undefined,
      })
      if (res.success) toast.success('Test notification sent')
      else toast.error(res.error ?? 'Test failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-1.5 rounded-[8px] border border-border-subtle bg-bg-tertiary/40 p-2.5">
      <Label className="text-[11px] text-text-tertiary">Test this action</Label>
      <div className="flex gap-1.5">
        <Input
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          placeholder="Chat ID (optional — falls back to configured chats)"
          className="h-8 flex-1 text-xs font-mono"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 gap-1 text-xs"
          onClick={run}
          loading={running}
          disabled={running}
        >
          <SendHorizontal className="h-3.5 w-3.5" />
          Send test
        </Button>
      </div>
      <p className="text-[10.5px] text-text-tertiary">
        Sends the message above right now — a real send, not a simulation.
      </p>
    </div>
  )
}

function ActionConfigFields({ actionType, config, onChange, variables, pickerData }: ActionConfigFieldsProps) {
  const get = (key: string) => (config[key] as string | undefined) ?? ''

  switch (actionType) {
    case 'send_whatsapp_message':
    case 'send_email':
      return (
        <>
          <VarField
            label="To"
            value={get('to')}
            onChange={(v) => onChange({ to: v })}
            placeholder={actionType === 'send_email' ? 'user@example.com' : '+14155551234'}
            variables={variables}
          />
          {actionType === 'send_email' && (
            <VarField
              label="Subject"
              value={get('subject')}
              onChange={(v) => onChange({ subject: v })}
              placeholder="Hi {{contact.first_name}}"
              variables={variables}
            />
          )}
          <VarTextareaField
            label="Message"
            value={get('body') || get('message')}
            onChange={(v) => onChange({ body: v, message: v })}
            rows={4}
            placeholder="Hi {{contact.first_name}}, …"
            variables={variables}
          />
        </>
      )

    case 'send_sms':
      return (
        <>
          <VarField
            label="To"
            value={get('to')}
            onChange={(v) => onChange({ to: v })}
            placeholder="+14155551234 or {{contact.phone}}"
            variables={variables}
          />
          <VarTextareaField
            label="Message"
            value={get('body')}
            onChange={(v) => onChange({ body: v })}
            rows={4}
            placeholder="Hi {{contact.first_name}}, …"
            variables={variables}
          />
          <PickerOrCustomField
            label="From number (optional)"
            value={get('phone_number_id')}
            onChange={(v) => onChange({ phone_number_id: v })}
            options={pickerData.numbers}
            variables={variables}
            placeholder="{{phone.id}}"
            optional
          />
          <TestSendSmsRow to={get('to')} body={get('body')} phoneNumberId={get('phone_number_id')} />
        </>
      )

    case 'send_whatsapp_template': {
      const bodyValues = Array.isArray(config.body_values)
        ? (config.body_values as string[]).join('\n')
        : ''
      return (
        <>
          <VarField
            label="To"
            value={get('to')}
            onChange={(v) => onChange({ to: v })}
            placeholder="+14155551234 or {{contact.phone}}"
            variables={variables}
          />
          <PickerOrCustomField
            label="Template"
            value={get('template_id')}
            onChange={(v) => onChange({ template_id: v })}
            options={pickerData.templates}
            variables={variables}
            placeholder="Approved template UUID or {{variable}}"
          />
          <VarTextareaField
            label="Body values (one per line)"
            value={bodyValues}
            onChange={(v) =>
              onChange({ body_values: v.split('\n').map((s) => s.trim()).filter(Boolean) })
            }
            rows={3}
            placeholder={'{{contact.first_name}}\n{{meeting.starts_at}}'}
            variables={variables}
          />
          <p className="text-[10.5px] text-text-tertiary">
            One value per line, in order, for the template&apos;s {`{{1}}`}, {`{{2}}`}… placeholders.
          </p>
        </>
      )
    }

    case 'http_request':
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Method</Label>
            <Select
              value={get('method') || 'GET'}
              onValueChange={(v) => onChange({ method: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <VarField
            label="URL"
            value={get('url')}
            onChange={(v) => onChange({ url: v })}
            placeholder="https://api.example.com/endpoint"
            variables={variables}
          />
        </>
      )

    case 'create_contact':
      return (
        <>
          <VarField label="Name" value={get('name')} onChange={(v) => onChange({ name: v })} placeholder="{{contact.name}}" variables={variables} />
          <VarField label="Email" value={get('email')} onChange={(v) => onChange({ email: v })} placeholder="{{contact.email}}" variables={variables} />
          <VarField label="Phone" value={get('phone')} onChange={(v) => onChange({ phone: v })} placeholder="{{contact.phone}}" variables={variables} />
        </>
      )

    case 'create_task':
      return (
        <>
          <VarField
            label="Title"
            value={get('title')}
            onChange={(v) => onChange({ title: v })}
            placeholder="Follow up with {{contact.first_name}}"
            variables={variables}
          />
          <VarTextareaField
            label="Description"
            value={get('description')}
            onChange={(v) => onChange({ description: v })}
            rows={2}
            placeholder="Optional details…"
            variables={variables}
          />
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Priority</Label>
            <Select value={get('priority') || 'medium'} onValueChange={(v) => onChange({ priority: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['low', 'medium', 'high', 'urgent'].map((p) => (
                  <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <VarField
            label="Due date"
            value={get('due_date')}
            onChange={(v) => onChange({ due_date: v })}
            placeholder="ISO date or {{meeting.starts_at}}"
            variables={variables}
          />
          <EntityLinkFields get={get} onChange={onChange} variables={variables} />
        </>
      )

    case 'create_note':
      return (
        <>
          <VarTextareaField
            label="Content"
            value={get('content')}
            onChange={(v) => onChange({ content: v })}
            rows={3}
            placeholder="Note body…"
            variables={variables}
          />
          <VarField
            label="Title (optional)"
            value={get('title')}
            onChange={(v) => onChange({ title: v })}
            placeholder="Short title"
            variables={variables}
          />
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">
            <Checkbox
              checked={get('pinned') === 'true' || (config.pinned as boolean) === true}
              onCheckedChange={(c) => onChange({ pinned: c === true })}
            />
            Pin this note
          </label>
          <EntityLinkFields get={get} onChange={onChange} variables={variables} />
        </>
      )

    case 'google_contacts_create':
    case 'google_contacts_update': {
      const isUpdate = actionType === 'google_contacts_update'
      return (
        <>
          <VarField
            label={`Email${isUpdate ? ' (used to find the contact)' : ''}`}
            value={get('email')}
            onChange={(v) => onChange({ email: v })}
            placeholder="{{contact.email}}"
            variables={variables}
          />
          <VarField label="Name" value={get('name')} onChange={(v) => onChange({ name: v })} placeholder="{{contact.name}}" variables={variables} />
          <VarField label="Phone" value={get('phone')} onChange={(v) => onChange({ phone: v })} placeholder="{{contact.phone}}" variables={variables} />
          <VarField label="Company" value={get('company')} onChange={(v) => onChange({ company: v })} placeholder="{{contact.company}}" variables={variables} />
          <VarTextareaField label="Notes" value={get('notes')} onChange={(v) => onChange({ notes: v })} placeholder="{{contact.notes}}" variables={variables} />
        </>
      )
    }

    case 'google_contacts_find':
      return (
        <>
          <VarField label="Email" value={get('email')} onChange={(v) => onChange({ email: v })} placeholder="{{contact.email}}" variables={variables} />
          <VarField label="Phone (used if email is empty)" value={get('phone')} onChange={(v) => onChange({ phone: v })} placeholder="{{contact.phone}}" variables={variables} />
        </>
      )

    case 'google_contacts_delete':
      return (
        <VarField
          label="Email (used to find the contact)"
          value={get('email')}
          onChange={(v) => onChange({ email: v })}
          placeholder="{{contact.email}}"
          variables={variables}
        />
      )

    case 'pipeline_move_opportunity':
      return (
        <>
          <VarField label="Opportunity ID" value={get('opportunity_id')} onChange={(v) => onChange({ opportunity_id: v })} placeholder="{{opportunity.id}}" variables={variables} mono />
          <PickerOrCustomField label="Stage" value={get('stage_name')} onChange={(v) => onChange({ stage_name: v })} options={pickerData.stages} variables={variables} placeholder="Stage name" />
        </>
      )

    case 'pipeline_mark_won':
      return (
        <VarField label="Opportunity ID" value={get('opportunity_id')} onChange={(v) => onChange({ opportunity_id: v })} placeholder="{{opportunity.id}}" variables={variables} mono />
      )

    case 'pipeline_mark_lost':
      return (
        <>
          <VarField label="Opportunity ID" value={get('opportunity_id')} onChange={(v) => onChange({ opportunity_id: v })} placeholder="{{opportunity.id}}" variables={variables} mono />
          <VarTextareaField label="Reason (optional)" value={get('reason')} onChange={(v) => onChange({ reason: v })} rows={2} placeholder="Why was it lost?" variables={variables} />
        </>
      )

    case 'pipeline_add_note':
      return (
        <>
          <VarField label="Opportunity ID" value={get('opportunity_id')} onChange={(v) => onChange({ opportunity_id: v })} placeholder="{{opportunity.id}}" variables={variables} mono />
          <VarTextareaField label="Note" value={get('content')} onChange={(v) => onChange({ content: v })} rows={3} placeholder="Note to append…" variables={variables} />
        </>
      )

    case 'pipeline_assign_user':
      return (
        <>
          <VarField label="Opportunity ID" value={get('opportunity_id')} onChange={(v) => onChange({ opportunity_id: v })} placeholder="{{opportunity.id}}" variables={variables} mono />
          <PickerOrCustomField label="Owner" value={get('user_id')} onChange={(v) => onChange({ user_id: v })} options={pickerData.members} variables={variables} placeholder="User UUID" />
        </>
      )

    case 'pipeline_update_opportunity':
      return (
        <>
          <VarField label="Opportunity ID" value={get('opportunity_id')} onChange={(v) => onChange({ opportunity_id: v })} placeholder="{{opportunity.id}}" variables={variables} mono />
          <VarField label="Title" value={get('title')} onChange={(v) => onChange({ title: v })} placeholder="Optional new title" variables={variables} />
          <VarField label="Value" value={get('value')} onChange={(v) => onChange({ value: v })} placeholder="1000" variables={variables} />
          <VarField label="Expected close date" value={get('expected_close_date')} onChange={(v) => onChange({ expected_close_date: v })} placeholder="YYYY-MM-DD" variables={variables} />
          <PickerOrCustomField label="Owner (optional)" value={get('assigned_to')} onChange={(v) => onChange({ assigned_to: v })} options={pickerData.members} variables={variables} placeholder="User UUID" optional />
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Status</Label>
            <Select value={get('status') || 'open'} onValueChange={(v) => onChange({ status: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['open', 'won', 'lost'].map((s) => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )

    case 'pipeline_create_opportunity':
      return (
        <>
          <VarField label="Title" value={get('title')} onChange={(v) => onChange({ title: v })} placeholder="New deal — {{contact.name}}" variables={variables} />
          <PickerOrCustomField label="Stage (optional)" value={get('stage_name')} onChange={(v) => onChange({ stage_name: v })} options={pickerData.stages} variables={variables} placeholder="Default pipeline if blank" optional />
          <VarField label="Contact ID" value={get('contact_id')} onChange={(v) => onChange({ contact_id: v })} placeholder="{{contact.id}}" variables={variables} mono />
          <VarField label="Contact phone" value={get('contact_phone')} onChange={(v) => onChange({ contact_phone: v })} placeholder="{{contact.phone}}" variables={variables} />
          <VarField label="Value" value={get('value')} onChange={(v) => onChange({ value: v })} placeholder="1000" variables={variables} />
        </>
      )

    case 'manychat_send_message':
      return (
        <>
          <VarField label="Subscriber ID" value={get('subscriber_id')} onChange={(v) => onChange({ subscriber_id: v })} placeholder="{{contact.id}}" variables={variables} mono />
          <VarTextareaField label="Message" value={get('message')} onChange={(v) => onChange({ message: v })} rows={3} placeholder="Hi {{contact.first_name}}…" variables={variables} />
        </>
      )

    case 'send_telegram_notification':
      return (
        <>
          <VarTextareaField label="Message" value={get('text')} onChange={(v) => onChange({ text: v })} rows={3} placeholder="Alert: {{contact.name}} just booked" variables={variables} />
          <VarField label="Chat ID (optional)" value={get('chat_id')} onChange={(v) => onChange({ chat_id: v })} placeholder="Falls back to the bot's configured chats" variables={variables} mono />
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Format</Label>
            <Select value={get('parse_mode') || 'HTML'} onValueChange={(v) => onChange({ parse_mode: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['HTML', 'Markdown', 'plain'].map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TestSendTelegramRow text={get('text')} chatId={get('chat_id')} parseMode={get('parse_mode') || 'HTML'} />
        </>
      )

    case 'custom_webhook':
      return (
        <>
          <VarField label="URL" value={get('url')} onChange={(v) => onChange({ url: v })} placeholder="https://api.example.com/hook" variables={variables} />
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Method</Label>
            <Select value={get('method') || 'POST'} onValueChange={(v) => onChange({ method: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <VarTextareaField label="Body" value={get('body')} onChange={(v) => onChange({ body: v })} rows={3} placeholder='{"name": "{{contact.name}}"}' variables={variables} />
        </>
      )

    case 'knowledge_base':
      return (
        <VarTextareaField
          label="Query"
          value={get('query')}
          onChange={(v) => onChange({ query: v })}
          rows={3}
          placeholder="What is the cancellation policy?"
          variables={variables}
        />
      )

    case 'execute_flow':
      return (
        <PickerOrCustomField
          label="Flow"
          value={get('flow_id')}
          onChange={(v) => onChange({ flow_id: v })}
          options={pickerData.flows}
          variables={variables}
          placeholder="Workflow ID or {{variable}}"
        />
      )

    default:
      return null
  }
}
