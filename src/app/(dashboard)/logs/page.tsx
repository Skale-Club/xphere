// src/app/(dashboard)/logs/page.tsx
// AI Logs and Observability dashboard — server component.
// Shows the last 100 event_logs for the current org, with filter tabs
// (All / Errors / Warnings) and color-coded severity badges.

import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import type { Database } from '@/types/database'

type EventLog = Database['public']['Tables']['event_logs']['Row']
type Severity = EventLog['severity']
type FilterTab = 'all' | 'errors' | 'warnings'

interface PageProps {
  searchParams: Promise<{ filter?: string }>
}

function severityBadgeVariant(severity: Severity): string {
  switch (severity) {
    case 'fatal':
    case 'error':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800'
    case 'warn':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800'
    case 'info':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800'
    case 'debug':
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700'
  }
}

function statusBadgeVariant(status: EventLog['status']): string {
  switch (status) {
    case 'failed':
      return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border-red-200 dark:border-red-800'
    case 'retried':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800'
    case 'skipped':
      return 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-500 border-gray-200 dark:border-gray-700'
    case 'ok':
    default:
      return 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800'
  }
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function truncate(text: string | null, maxLen = 80): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

export default async function LogsPage({ searchParams }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const { filter: filterParam } = await searchParams
  const activeFilter: FilterTab =
    filterParam === 'errors' ? 'errors'
    : filterParam === 'warnings' ? 'warnings'
    : 'all'

  const supabase = await createClient()

  // Build query — RLS automatically scopes to current org
  let query = supabase
    .from('event_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (activeFilter === 'errors') {
    query = query.in('severity', ['error', 'fatal'])
  } else if (activeFilter === 'warnings') {
    query = query.eq('severity', 'warn')
  }

  const { data: logs, error } = await query

  const entries = (logs ?? []) as EventLog[]

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'errors', label: 'Errors' },
    { id: 'warnings', label: 'Warnings' },
  ]

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Operational event log — last 100 entries for this workspace
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            href={tab.id === 'all' ? '/logs' : `/logs?filter=${tab.id}`}
            className={[
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeFilter === tab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-sm text-red-800 dark:text-red-400">
          Failed to load logs: {error.message}
        </div>
      )}

      {!error && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
          <p className="text-base font-medium">No log entries found</p>
          <p className="text-sm mt-1">Events will appear here as the system processes requests.</p>
        </div>
      )}

      {!error && entries.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Time</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Severity</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Event Type</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap font-mono text-xs">
                    {formatTime(entry.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                        severityBadgeVariant(entry.severity),
                      ].join(' ')}
                    >
                      {entry.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{entry.event_type}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{entry.source}</td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                        statusBadgeVariant(entry.status),
                      ].join(' ')}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-red-600 dark:text-red-400 text-xs max-w-[300px] truncate">
                    {truncate(entry.error_message)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
