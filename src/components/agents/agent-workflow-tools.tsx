'use client'

// SEED-033 — agent edit page surface for attaching workflows as tools.
//
// Renders the list of workflows currently attached to the agent (via
// agent_tools.workflow_id) with a remove [×] button per row, plus a
// combobox of available org workflows to attach. Workflows are surfaced
// distinctly from legacy tool_configs (which the existing ToolPicker
// already handles) — the icons map per the SEED:
//   ⚡  workflow kind='tool'
//   ⚡⚡ workflow kind='flow' (multi-step) — annotated inline as "(multi-step flow)"

import { useState, useTransition } from 'react'
import { Zap, X, Plus, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  attachWorkflowToAgent,
  detachWorkflowFromAgent,
  type AttachedWorkflow,
  type WorkflowPickerItem,
} from '@/app/(dashboard)/agents/actions'

interface AgentWorkflowToolsProps {
  agentId: string
  initialAttached: AttachedWorkflow[]
  initialAvailable: WorkflowPickerItem[]
}

export function AgentWorkflowTools({
  agentId,
  initialAttached,
  initialAvailable,
}: AgentWorkflowToolsProps) {
  const [attached, setAttached] = useState(initialAttached)
  const [available, setAvailable] = useState(initialAvailable)
  const [picked, setPicked] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAttach() {
    if (!picked) return
    const target = available.find((w) => w.id === picked)
    if (!target) return
    startTransition(async () => {
      const res = await attachWorkflowToAgent(agentId, picked)
      if (res && 'error' in res && res.error) {
        toast.error(res.error)
        return
      }
      setAttached((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          workflow_id: target.id,
          tool_name: target.tool_name,
          name: target.name,
          kind: target.kind,
          is_active: target.is_active,
          health_blocked: target.health_blocked,
          allowed_channels: null,
        },
      ])
      setAvailable((prev) => prev.filter((w) => w.id !== picked))
      setPicked(null)
      toast.success(`Attached ${target.tool_name}`)
    })
  }

  function handleDetach(row: AttachedWorkflow) {
    startTransition(async () => {
      const res = await detachWorkflowFromAgent(agentId, row.workflow_id)
      if (res && 'error' in res && res.error) {
        toast.error(res.error)
        return
      }
      setAttached((prev) => prev.filter((r) => r.id !== row.id))
      setAvailable((prev) => [
        ...prev,
        {
          id: row.workflow_id,
          tool_name: row.tool_name ?? row.name,
          name: row.name,
          description: null,
          kind: row.kind,
          is_active: row.is_active,
          health_blocked: row.health_blocked,
        },
      ])
      toast.success('Workflow detached')
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Attached workflows</h3>
        <p className="text-xs text-muted-foreground">
          Workflows the agent can invoke as native tools. Multi-step flows are
          executed inline up to a 30s timeout.
        </p>
      </div>

      {attached.length === 0 ? (
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          No workflows attached yet.
        </p>
      ) : (
        <ul className="border rounded-md divide-y">
          {attached.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 px-3 py-2 text-sm"
            >
              <Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              <span className="font-medium">{row.tool_name ?? row.name}</span>
              <Badge variant="outline" className="text-[10px]">
                {row.kind === 'flow' ? 'multi-step flow' : 'workflow'}
              </Badge>
              {row.health_blocked && (
                <span className="inline-flex items-center gap-1 text-amber-600 text-[11px]">
                  <AlertTriangle className="h-3 w-3" /> health-blocked
                </span>
              )}
              {!row.is_active && (
                <span className="text-[11px] text-muted-foreground">
                  inactive
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 w-7 p-0"
                onClick={() => handleDetach(row)}
                disabled={isPending}
                aria-label={`Detach ${row.tool_name ?? row.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            value={picked ?? undefined}
            onValueChange={(v) => setPicked(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a workflow to attach…" />
            </SelectTrigger>
            <SelectContent>
              {available.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  No more workflows available. Create one under{' '}
                  <span className="font-mono">/workflows</span>.
                </div>
              ) : (
                available.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.tool_name} —{' '}
                    {w.kind === 'flow' ? 'multi-step flow' : 'workflow'}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleAttach}
          disabled={!picked || isPending}
        >
          <Plus className="h-3.5 w-3.5" /> Add workflow
        </Button>
      </div>
    </div>
  )
}
