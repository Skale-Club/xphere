'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Trash2, X } from 'lucide-react'
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
  type IntegrationKey,
} from '@/lib/flows/node-metadata'
import { cn } from '@/lib/utils'

const NODE_TYPE_LABEL: Record<string, string> = {
  trigger: 'Trigger',
  action: 'Action',
  condition: 'Condition',
  wait: 'Wait',
  agent: 'Agent',
  end: 'End',
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
  const [advancedOpen, setAdvancedOpen] = useState(false)

  if (!node) {
    return (
      <div className="w-72 border-l border-border bg-card shrink-0 flex flex-col">
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
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
      {/* Header — friendly title + type subtitle */}
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
              <Select
                value={flow.event_type}
                onValueChange={(v) => updateNodeData(node.id, { event_type: v })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectedTriggerLabel value={flow.event_type} />
                </SelectTrigger>
                <SelectContent>
                  {filterTriggers(activeSet).length === 0 && (
                    <div className="px-2 py-1.5 text-[11px] text-text-tertiary">
                      No triggers available — connect an integration first.
                    </div>
                  )}
                  {/* Always include the currently selected event so user can change away */}
                  {filterTriggers(activeSet).map((m) => {
                    const Icon = m.icon
                    return (
                      <SelectItem key={m.key} value={m.key} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded-[5px]', m.iconClass)}>
                            <Icon className="h-3 w-3" />
                          </span>
                          <span>{m.label}</span>
                        </div>
                      </SelectItem>
                    )
                  })}
                  {/* Fallback: if currently selected isn't in the filtered list, surface it */}
                  {!filterTriggers(activeSet).some((m) => m.key === flow.event_type) &&
                    getTriggerMetadata(flow.event_type) && (
                    <SelectItem value={flow.event_type} className="text-xs opacity-70">
                      <span>{getTriggerMetadata(flow.event_type)!.label} · disconnected</span>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
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
                  e.g. <code>0 9 * * 1</code> — every Monday at 9 AM
                </p>
              </div>
            )}
          </>
        )}

        {flow.kind === 'action' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Action</Label>
              <Select
                value={flow.action_type}
                onValueChange={(v) => updateNodeData(node.id, { action_type: v, config: {} })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectedActionLabel value={flow.action_type} />
                </SelectTrigger>
                <SelectContent>
                  {filterActions(activeSet).map((m) => {
                    const Icon = m.icon
                    return (
                      <SelectItem key={m.key} value={m.key} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded-[5px]', m.iconClass)}>
                            <Icon className="h-3 w-3" />
                          </span>
                          <span>{m.label}</span>
                        </div>
                      </SelectItem>
                    )
                  })}
                  {!filterActions(activeSet).some((m) => m.key === flow.action_type) &&
                    getActionMetadata(flow.action_type) && (
                    <SelectItem value={flow.action_type} className="text-xs opacity-70">
                      <span>{getActionMetadata(flow.action_type)!.label} · disconnected</span>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
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
              onChange={(patch) =>
                updateNodeData(node.id, { config: { ...(flow.config ?? {}), ...patch } })
              }
            />

            {/* Advanced (collapsed by default) */}
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
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-text-tertiary">Credential ref</Label>
                  <Input
                    value={flow.credential_ref ?? ''}
                    onChange={(e) => updateNodeData(node.id, { credential_ref: e.target.value })}
                    placeholder="auto-resolved by default"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
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
                onValueChange={(v) => updateNodeData(node.id, { mode: v as 'sleep' | 'wait_for_event' })}
              >
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sleep" className="text-xs">Sleep (duration)</SelectItem>
                  <SelectItem value="wait_for_event" className="text-xs">Wait for event</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {flow.mode === 'sleep' ? (
              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-tertiary">Duration</Label>
                <Input
                  value={flow.duration ?? ''}
                  onChange={(e) => updateNodeData(node.id, { duration: e.target.value })}
                  placeholder="1h, 30m, 24h, 7d"
                  className="h-8 text-xs"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-tertiary">Timeout</Label>
                <Input
                  value={flow.timeout ?? ''}
                  onChange={(e) => updateNodeData(node.id, { timeout: e.target.value })}
                  placeholder="7d"
                  className="h-8 text-xs"
                />
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

function SelectedTriggerLabel({ value }: { value: string }) {
  const meta = getTriggerMetadata(value)
  if (!meta) return <SelectValue placeholder="Choose a trigger" />
  const Icon = meta.icon
  return (
    <span className="flex items-center gap-2">
      <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded-[5px]', meta.iconClass)}>
        <Icon className="h-3 w-3" />
      </span>
      <span className="truncate">{meta.label}</span>
    </span>
  )
}

function SelectedActionLabel({ value }: { value: string }) {
  const meta = getActionMetadata(value)
  if (!meta) return <SelectValue placeholder="Choose an action" />
  const Icon = meta.icon
  return (
    <span className="flex items-center gap-2">
      <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded-[5px]', meta.iconClass)}>
        <Icon className="h-3 w-3" />
      </span>
      <span className="truncate">{meta.label}</span>
    </span>
  )
}

interface ActionConfigFieldsProps {
  actionType: string
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}

function ActionConfigFields({ actionType, config, onChange }: ActionConfigFieldsProps) {
  const get = (key: string) => (config[key] as string | undefined) ?? ''

  switch (actionType) {
    case 'send_whatsapp':
    case 'send_email':
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">To</Label>
            <Input
              value={get('to')}
              onChange={(e) => onChange({ to: e.target.value })}
              placeholder={actionType === 'send_email' ? 'user@example.com or {{trigger.email}}' : '+14155551234 or {{trigger.phone}}'}
              className="h-8 text-xs"
            />
          </div>
          {actionType === 'send_email' && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-tertiary">Subject</Label>
              <Input
                value={get('subject')}
                onChange={(e) => onChange({ subject: e.target.value })}
                placeholder="Hi {{contact.first_name}}"
                className="h-8 text-xs"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Message</Label>
            <Textarea
              value={get('body') || get('message')}
              onChange={(e) => onChange({ body: e.target.value, message: e.target.value })}
              rows={4}
              className="text-xs resize-none"
              placeholder="Hi {{contact.first_name}}, …"
            />
          </div>
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
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">URL</Label>
            <Input
              value={get('url')}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="https://api.example.com/endpoint"
              className="h-8 text-xs"
            />
          </div>
        </>
      )

    case 'create_contact':
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Name</Label>
            <Input
              value={get('name')}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="{{trigger.name}}"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Email</Label>
            <Input
              value={get('email')}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="{{trigger.email}}"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">Phone</Label>
            <Input
              value={get('phone')}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="{{trigger.phone}}"
              className="h-8 text-xs"
            />
          </div>
        </>
      )

    case 'create_task':
    case 'create_note':
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-text-tertiary">{actionType === 'create_task' ? 'Title' : 'Content'}</Label>
            <Textarea
              value={get(actionType === 'create_task' ? 'title' : 'content')}
              onChange={(e) => onChange({ [actionType === 'create_task' ? 'title' : 'content']: e.target.value })}
              rows={3}
              className="text-xs resize-none"
              placeholder="What needs to happen?"
            />
          </div>
        </>
      )

    case 'update_pipeline_stage':
      return (
        <div className="space-y-1.5">
          <Label className="text-[11px] text-text-tertiary">Stage</Label>
          <Input
            value={get('stage')}
            onChange={(e) => onChange({ stage: e.target.value })}
            placeholder="qualified | proposal | won | lost"
            className="h-8 text-xs"
          />
        </div>
      )

    case 'query_knowledge':
      return (
        <div className="space-y-1.5">
          <Label className="text-[11px] text-text-tertiary">Query</Label>
          <Textarea
            value={get('query')}
            onChange={(e) => onChange({ query: e.target.value })}
            rows={3}
            className="text-xs resize-none"
            placeholder="What is the cancellation policy?"
          />
        </div>
      )

    case 'execute_flow':
      return (
        <div className="space-y-1.5">
          <Label className="text-[11px] text-text-tertiary">Flow ID</Label>
          <Input
            value={get('flow_id')}
            onChange={(e) => onChange({ flow_id: e.target.value })}
            placeholder="flow_xxx"
            className="h-8 text-xs font-mono"
          />
        </div>
      )

    default:
      return null
  }
}
