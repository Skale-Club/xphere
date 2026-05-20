// SEED-025 Phase E: unified workflows list. Replaces the tabs view —
// every row is a workflow regardless of internal kind and trigger type.

import Link from 'next/link'
import {
  Workflow as WorkflowIcon,
  Calendar,
  Clock,
  MousePointerClick,
  Webhook,
  type LucideIcon,
} from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { WorkflowToggle } from './workflow-toggle'

interface WorkflowSummary {
  id: string
  name: string
  slug: string
  description: string | null
  is_active: boolean
  kind: 'tool' | 'flow'
  trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
  trigger_config: Record<string, unknown>
  health_blocked: boolean
  health_blocked_reason: string | null
  updated_at: string
}

interface Props {
  workflows: WorkflowSummary[]
}

const TRIGGER_META: Record<
  WorkflowSummary['trigger_type'],
  { label: string; Icon: LucideIcon }
> = {
  tool_call: { label: 'Tool call', Icon: MousePointerClick },
  event: { label: 'Event', Icon: Calendar },
  schedule: { label: 'Schedule', Icon: Clock },
  manual: { label: 'Manual', Icon: MousePointerClick },
  webhook_url: { label: 'Webhook', Icon: Webhook },
}

function triggerLabel(workflow: WorkflowSummary): string {
  const meta = TRIGGER_META[workflow.trigger_type]
  if (workflow.trigger_type === 'event') {
    const eventName = workflow.trigger_config?.event as string | undefined
    return eventName ? eventName.replace('meeting.', 'Meeting · ') : meta.label
  }
  if (workflow.trigger_type === 'tool_call') {
    const toolName = workflow.trigger_config?.tool_name as string | undefined
    return toolName ? `Tool · ${toolName}` : meta.label
  }
  if (workflow.trigger_type === 'schedule') {
    const cron = workflow.trigger_config?.cron as string | undefined
    return cron ? `Cron · ${cron}` : meta.label
  }
  return meta.label
}

export function WorkflowsList({ workflows }: Props) {
  if (workflows.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <WorkflowIcon className="mx-auto h-8 w-8 text-text-tertiary mb-3" />
          <p className="text-sm font-medium text-text-primary mb-1">No workflows yet</p>
          <p className="text-sm text-text-secondary mb-4">
            Build your first workflow visually, or ask Copilot to create one from a single sentence.
          </p>
          <Link
            href="/workflows/flows/new"
            className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            <WorkflowIcon className="h-3.5 w-3.5" />
            Create your first workflow
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-secondary/30 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary/60">
          <tr className="text-xs text-text-tertiary uppercase tracking-wide">
            <th className="text-left font-medium px-4 py-2.5">Name</th>
            <th className="text-left font-medium px-4 py-2.5">Trigger</th>
            <th className="text-left font-medium px-4 py-2.5">Status</th>
            <th className="text-right font-medium px-4 py-2.5">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {workflows.map((w) => {
            const Icon = TRIGGER_META[w.trigger_type].Icon
            return (
              <tr key={w.id} className="hover:bg-bg-secondary/40 transition-colors">
                <td className="px-4 py-3">
                  <Link href={w.kind === 'flow' ? `/workflows/flows/${w.id}` : `/workflows/${w.id}`} className="block group">
                    <p className="text-sm font-medium text-text-primary group-hover:underline truncate">
                      {w.name}
                    </p>
                    {w.description && (
                      <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1">
                        {w.description}
                      </p>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                    <Icon className="h-3 w-3 text-text-tertiary" />
                    {triggerLabel(w)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <WorkflowToggle
                    workflowId={w.id}
                    initialActive={w.is_active}
                    blocked={w.health_blocked}
                    blockedReason={w.health_blocked_reason}
                  />
                </td>
                <td className="px-4 py-3 text-right text-[11px] text-text-tertiary tabular-nums">
                  {formatDistanceToNow(parseISO(w.updated_at), { addSuffix: true })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
