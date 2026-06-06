'use client'

// src/components/agents/invocations-list.tsx
// Phase 40 OBS-07: Filterable invocations table for /dashboard/agents/[id]/invocations.
// Filters via URL search params (router.push). Clicking a row opens InvocationDetailDrawer.

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { InvocationDetailDrawer } from './invocation-detail-drawer'
import {
  getInvocationDelegationTree,
  type InvocationListItem,
} from '@/lib/agent-runtime/observability'
import { INVOCATIONS_PAGE_SIZE } from '@/lib/agent-runtime/constants'

const STATUS_OPTIONS = ['success', 'error', 'aborted', 'skipped', 'denied'] as const

function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-400/30'
    case 'error':
      return 'bg-red-500/10 text-red-700 border-red-400/30'
    case 'aborted':
      return 'bg-orange-500/10 text-orange-700 border-orange-400/30'
    case 'skipped':
      return 'bg-yellow-500/10 text-yellow-700 border-yellow-400/30'
    case 'denied':
      return 'bg-gray-500/10 text-gray-700 border-gray-400/30'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function formatMs(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(usd: number | null): string {
  if (usd === null) return '-'
  if (usd === 0) return '$0.00'
  if (usd < 0.0001) return '<$0.0001'
  return `$${usd.toFixed(4)}`
}

interface InvocationsListProps {
  agentId: string
  initialRows: InvocationListItem[]
  initialTotal: number
  currentPage: number
}

export function InvocationsList({
  agentId,
  initialRows,
  initialTotal,
  currentPage,
}: InvocationsListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const totalPages = Math.ceil(initialTotal / INVOCATIONS_PAGE_SIZE)

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete('page') // reset to page 1 on filter change
    startTransition(() => {
      router.push(`?${params.toString()}`)
    })
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(newPage))
    startTransition(() => {
      router.push(`?${params.toString()}`)
    })
  }

  function handleRowClick(id: string) {
    setSelectedId(id)
    setDrawerOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={searchParams.get('status') ?? ''}
          onValueChange={(v) => updateParam('status', v === '_all' ? '' : v)}
        >
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Min cost (USD)"
          type="number"
          step="0.0001"
          min="0"
          className="w-32 h-8 text-sm"
          defaultValue={searchParams.get('minCost') ?? ''}
          onBlur={(e) => updateParam('minCost', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              updateParam('minCost', (e.target as HTMLInputElement).value)
          }}
        />
        <Input
          placeholder="Search errors..."
          className="w-48 h-8 text-sm"
          defaultValue={searchParams.get('error') ?? ''}
          onBlur={(e) => updateParam('error', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              updateParam('error', (e.target as HTMLInputElement).value)
          }}
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {initialTotal.toLocaleString()} invocations
        </span>
      </div>

      {/* Table */}
      {initialRows.length === 0 ? (
        <div className="flex items-center justify-center h-32 border border-dashed rounded-lg text-sm text-muted-foreground">
          No invocations match the current filters.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Duration</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-left font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {initialRows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => handleRowClick(row.id)}
                >
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap font-mono text-xs">
                    {format(new Date(row.createdAt), 'MMM d HH:mm:ss')}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${statusColor(row.status)}`}
                    >
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                    {formatMs(row.durationMs)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                    {formatCost(row.costUsd)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">
                    {row.errorDetail ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Detail drawer | opens on row click */}
      {selectedId && (
        <InvocationDetailDrawer
          invocationId={selectedId}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          fetchTree={getInvocationDelegationTree}
        />
      )}
    </div>
  )
}
