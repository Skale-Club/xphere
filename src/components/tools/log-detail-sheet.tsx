'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import Link from 'next/link'
import { format } from 'date-fns'
import type { LogWithCall } from '@/app/(dashboard)/workflows/logs/actions'

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[Unable to display payload]'
  }
}

interface LogDetailSheetProps {
  log: LogWithCall | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogDetailSheet({ log, open, onOpenChange }: LogDetailSheetProps) {
  if (!log) return null

  const statusClassName =
    log.status === 'success'
      ? 'bg-emerald-500/15 text-emerald-400'
      : log.status === 'timeout'
      ? 'bg-yellow-500/15 text-yellow-400'
      : 'bg-red-500/15 text-red-400'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] w-[min(calc(100vw-32px),760px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Badge variant="outline" className={statusClassName}>{log.status}</Badge>
            <span className="font-mono text-sm">{log.execution_ms}ms</span>
          </DialogTitle>
          <DialogDescription asChild>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            <p>{format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}</p>
            <p>Workflow: <span className="font-mono">{log.workflow_name ?? log.tool_name}</span></p>
            <p>Call ID: <span className="font-mono break-all">{log.vapi_call_id}</span></p>
            {log.call && (
              <p>
                <Link
                  href={`/calls?call=${log.call.id}`}
                  className="underline-offset-4 hover:underline text-foreground"
                >
                  View related call
                </Link>
                {(log.call.customer_name || log.call.customer_number) && (
                  <span> · {log.call.customer_name ?? log.call.customer_number}</span>
                )}
              </p>
            )}
          </div>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-4">
            {log.error_detail && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                <p className="text-xs font-medium text-red-400 mb-1">Error</p>
                <p className="text-sm text-red-300">{log.error_detail}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                Request Payload
              </p>
              <pre className="rounded-md border bg-muted/20 p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words">
                {safeStringify(log.request_payload)}
              </pre>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                Response Payload
              </p>
              <pre className="rounded-md border bg-muted/20 p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words">
                {safeStringify(log.response_payload)}
              </pre>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
