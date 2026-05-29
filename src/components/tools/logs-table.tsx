'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { LogDetailSheet } from './log-detail-sheet'
import type { LogWithCall } from '@/app/(dashboard)/workflows/logs/actions'

interface LogsTableProps {
  logs: LogWithCall[]
  total: number
  page: number
  pageCount: number
  showWorkflowColumn?: boolean
  prevHref: string | null
  nextHref: string | null
}

function StatusBadge({ status }: { status: 'success' | 'error' | 'timeout' }) {
  const className =
    status === 'success'
      ? 'bg-emerald-500/15 text-emerald-400'
      : status === 'timeout'
      ? 'bg-yellow-500/15 text-yellow-400'
      : 'bg-red-500/15 text-red-400'
  return (
    <Badge variant="outline" className={className}>
      {status}
    </Badge>
  )
}

export function LogsTable({
  logs,
  total,
  page,
  pageCount,
  showWorkflowColumn = false,
  prevHref,
  nextHref,
}: LogsTableProps) {
  const [selectedLog, setSelectedLog] = useState<LogWithCall | null>(null)

  if (logs.length === 0) {
    return (
      <div className="rounded-md border">
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          No logs found for the selected filters.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Time</TableHead>
              {showWorkflowColumn && <TableHead className="text-xs">Workflow</TableHead>}
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Duration</TableHead>
              <TableHead className="text-xs">Call ID</TableHead>
              <TableHead className="text-xs">Caller</TableHead>
              <TableHead className="text-xs w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedLog(log)}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                </TableCell>
                {showWorkflowColumn && (
                  <TableCell className="font-mono text-xs max-w-[160px] truncate">
                    {log.workflow_name ?? log.tool_name}
                  </TableCell>
                )}
                <TableCell>
                  <StatusBadge status={log.status} />
                </TableCell>
                <TableCell className="text-xs font-mono">{log.execution_ms}ms</TableCell>
                <TableCell className="font-mono text-xs max-w-[140px] truncate text-muted-foreground">
                  {log.vapi_call_id}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {log.call
                    ? (log.call.customer_name ?? log.call.customer_number ?? '-')
                    : '-'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedLog(log)
                    }}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{total} total log{total !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-2">
          <span>Page {page} of {pageCount || 1}</span>
          {prevHref ? (
            <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
              <Link href={prevHref}>Previous</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled>
              Previous
            </Button>
          )}
          {nextHref ? (
            <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
              <Link href={nextHref}>Next</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled>
              Next
            </Button>
          )}
        </div>
      </div>

      <LogDetailSheet
        log={selectedLog}
        open={!!selectedLog}
        onOpenChange={(open) => { if (!open) setSelectedLog(null) }}
      />
    </div>
  )
}
