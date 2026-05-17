'use client'

// src/components/conversations/delegation-tree.tsx
// Phase 40 OBS-06, OBS-07: Collapsible recursive delegation tree component.
// Used in /dashboard/conversations/[id] and the InvocationDetailDrawer.

import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { InvocationTreeNode } from '@/lib/agent-runtime/observability'

interface DelegationTreeProps {
  roots: InvocationTreeNode[]
}

function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-400/30 dark:text-emerald-400'
    case 'error':
      return 'bg-red-500/10 text-red-700 border-red-400/30 dark:text-red-400'
    case 'aborted':
      return 'bg-orange-500/10 text-orange-700 border-orange-400/30 dark:text-orange-400'
    case 'skipped':
      return 'bg-yellow-500/10 text-yellow-700 border-yellow-400/30 dark:text-yellow-400'
    case 'denied':
      return 'bg-gray-500/10 text-gray-700 border-gray-400/30 dark:text-gray-400'
    case 'running':
      return 'bg-blue-500/10 text-blue-700 border-blue-400/30 dark:text-blue-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function formatMs(ms: number | null): string {
  if (ms === null || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd === 0) return '$0.00'
  if (usd < 0.0001) return '<$0.0001'
  return `$${usd.toFixed(4)}`
}

function DelegationNode({
  node,
  level,
}: {
  node: InvocationTreeNode
  level: number
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/40 transition-colors"
        style={{ paddingLeft: `${12 + level * 20}px` }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}

        {/* Agent name */}
        <span className="font-medium text-sm min-w-[100px]">{node.agentName}</span>

        {/* Status badge */}
        <Badge
          variant="outline"
          className={`text-[10px] shrink-0 ${statusColor(node.status)}`}
        >
          {node.status}
        </Badge>

        {/* Latency + cost */}
        <span className="text-xs text-muted-foreground ml-auto shrink-0 font-mono tabular-nums">
          {formatMs(node.durationMs)} · {formatCost(node.costUsd)}
        </span>
      </div>

      {/* Render children with increased indentation */}
      {hasChildren && open && (
        <div className="border-l-2 border-muted ml-6">
          {node.children.map((child) => (
            <DelegationNode key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function DelegationTree({ roots }: DelegationTreeProps) {
  if (roots.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground border border-dashed rounded-lg">
        No agent invocations found.
      </div>
    )
  }

  return (
    <div className="space-y-1 border rounded-lg p-2 bg-card">
      {roots.map((root) => (
        <DelegationNode key={root.id} node={root} level={0} />
      ))}
    </div>
  )
}
