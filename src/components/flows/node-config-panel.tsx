'use client'

import { forwardRef, useState, type ButtonHTMLAttributes } from 'react'
import { Braces, Check, ChevronDown, ChevronRight, Trash2, X } from 'lucide-react'
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
  const safeAmount = Math.max(1, Number(amount) || 1)
  return `${safeAmount}${unit}`
}

interface NodeConfigPanelProps {
  activeIntegrations: IntegrationKey[]
}

export function NodeConfigPanel({ activeIntegrations }: NodeConfigPanelProps) {
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
  const [advancedOpen, setAdvancedOpen] = useState(false)

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
            {flow.event_type === 'cron' && (
              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-tertiary">Cron schedule</Label>
                <Input
                  value={flow.schedule_cron ?? ''}
                  onChange={(e) => updateNodeData(node.id, { schedule_cron: e.target.value })}
                  placeholder="0 9 * * 1"
                  className="h-8 text-xs font-mono"
                />
                <p className="text-[10.5px] text-text-tertiary">
                  e.g. <code>0 9 * * 1</code> | every Monday at 9 AM
                </p>
              </div>
            )}
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
              onChange={(patch) =>
                updateNodeData(node.id, { config: { ...(flow.config ?? {}), ...patch } })
              }
            />

            {/* Advanced (raw JSON) is shown ONLY for actions without dedicated
                fields — there it's the only editor. Actions with fields (Google
                Contacts, send_email, …) have no Advanced section at all. */}
            {!ACTION_TYPES_WITH_FIELDS.has(flow.action_type) && (
              <>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary"
                >
                  {advancedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Advanced
                </button>
                {advancedOpen && (
                  <div className="space-y-3 pt-1 pl-2 border-l border-border-subtle">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-text-tertiary">Config (raw JSON)</Label>
                      <Textarea
                        value={JSON.stringify(flow.config ?? {}, null, 2)}
                        onChange={(e) => {
                          try {
                            updateNodeData(node.id, { config: JSON.parse(e.target.value) })
                          } catch {
                            /* ignore parse errors while typing */
                          }
                        }}
                        rows={6}
                        className="text-xs font-mono resize-none"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {flow.kind === 'condition' && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Condition (JSONata)</Label>
            <Textarea
              value={flow.expression}
              onChange={(e) => updateNodeData(node.id, { expression: e.target.value })}
              rows={4}
              className="text-xs font-mono resize-none"
              placeholder="trigger.payload.amount > 100"
            />
            <p className="text-[10.5px] text-text-tertiary">
              True → green output, false → red.
            </p>
          </div>
        )}

        {flow.kind === 'wait' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Mode</Label>
              <Select
                value={flow.mode}
                onValueChange={(v) => {
                  const mode = v as 'sleep' | 'wait_for_event'
                  updateNodeData(
                    node.id,
                    mode === 'sleep'
                      ? { mode, duration: flow.duration ?? '1h' }
                      : { mode, timeout: flow.timeout ?? '7d' },
                  )
                }}
              >
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sleep" className="text-xs">Sleep (duration)</SelectItem>
                  <SelectItem value="wait_for_event" className="text-xs">Wait for event</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {flow.mode === 'sleep' ? (
              <DurationField
                label="Duration"
                value={flow.duration}
                fallback="1h"
                onChange={(duration) => updateNodeData(node.id, { duration })}
              />
            ) : (
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
                      <SelectItem value="meeting.starts_in" className="text-xs">Meeting starts in...</SelectItem>
                      <SelectItem value="meeting.completed" className="text-xs">Meeting completed</SelectItem>
                      <SelectItem value="meeting.no_show" className="text-xs">Meeting no-show</SelectItem>
                      <SelectItem value="meeting.rescheduled" className="text-xs">Meeting rescheduled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {flow.event_type === 'meeting.starts_in' && (
                  <DurationField
                    label="Offset before event"
                    value={flow.offset}
                    fallback="5m"
                    onChange={(offset) => updateNodeData(node.id, { offset })}
                  />
                )}
              </div>
            )}
          </>
        )}

        {flow.kind === 'agent' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Agent ID (optional)</Label>
              <Input
                value={flow.agent_id ?? ''}
                onChange={(e) => updateNodeData(node.id, { agent_id: e.target.value })}
                placeholder="agent_xxx"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">System prompt</Label>
              <Textarea
                value={flow.system_prompt}
                onChange={(e) => updateNodeData(node.id, { system_prompt: e.target.value })}
                rows={4}
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

// Action types that render dedicated form fields in ActionConfigFields. For
// these the raw-JSON editor is redundant (the form owns the config), so it is
// hidden. Unmapped actions fall through to the raw JSON, which is then their
// only editor. Keep this in sync with the switch in ActionConfigFields.
const ACTION_TYPES_WITH_FIELDS = new Set<string>([
  'send_whatsapp',
  'send_email',
  'http_request',
  'create_contact',
  'create_task',
  'create_note',
  'update_pipeline_stage',
  'query_knowledge',
  'execute_flow',
  'google_contacts_create',
  'google_contacts_update',
  'google_contacts_find',
  'google_contacts_delete',
])

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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  variables: VariableGroup[]
  rows?: number
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabelRow label={label} variables={variables} onInsert={(t) => onChange(appendVariableToken(value, t))} />
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="text-xs resize-none"
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
}

function ActionConfigFields({ actionType, config, onChange, variables }: ActionConfigFieldsProps) {
  const get = (key: string) => (config[key] as string | undefined) ?? ''

  switch (actionType) {
    case 'send_whatsapp':
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
    case 'create_note': {
      const key = actionType === 'create_task' ? 'title' : 'content'
      return (
        <VarTextareaField
          label={actionType === 'create_task' ? 'Title' : 'Content'}
          value={get(key)}
          onChange={(v) => onChange({ [key]: v })}
          rows={3}
          placeholder="What needs to happen?"
          variables={variables}
        />
      )
    }

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

    case 'update_pipeline_stage':
      return (
        <VarField
          label="Stage"
          value={get('stage')}
          onChange={(v) => onChange({ stage: v })}
          placeholder="qualified | proposal | won | lost"
          variables={variables}
        />
      )

    case 'query_knowledge':
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
        <VarField
          label="Flow ID"
          value={get('flow_id')}
          onChange={(v) => onChange({ flow_id: v })}
          placeholder="flow_xxx"
          variables={variables}
          mono
        />
      )

    default:
      return null
  }
}
