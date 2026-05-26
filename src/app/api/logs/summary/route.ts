// src/app/api/logs/summary/route.ts
// AI Logs Summary endpoint — returns an aggregated snapshot of event_logs
// for the last 24 hours scoped to the authenticated org.
//
// Intended for AI agents, dashboards, and monitoring tools to quickly
// assess system health without reading raw log entries.

export const runtime = 'nodejs'

import { createClient, getUser } from '@/lib/supabase/server'

type SummaryStatus = 'ok' | 'degraded'

interface LogSummary {
  period: 'last_24h'
  total: number
  by_severity: Record<string, number>
  by_source: Record<string, number>
  recent_errors: Array<{
    event_type: string
    error_message: string | null
    created_at: string
  }>
  status: SummaryStatus
}

export async function GET(): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Fetch all logs from the last 24h — RLS scopes to current org automatically
  const { data: logs, error } = await supabase
    .from('event_logs')
    .select('event_type, source, severity, status, error_message, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const entries = logs ?? []
  const total = entries.length

  // Aggregate by severity
  const by_severity: Record<string, number> = {}
  for (const entry of entries) {
    by_severity[entry.severity] = (by_severity[entry.severity] ?? 0) + 1
  }

  // Aggregate by source
  const by_source: Record<string, number> = {}
  for (const entry of entries) {
    by_source[entry.source] = (by_source[entry.source] ?? 0) + 1
  }

  // Collect up to 10 most recent errors/fatals
  const recent_errors = entries
    .filter((e) => e.severity === 'error' || e.severity === 'fatal')
    .slice(0, 10)
    .map((e) => ({
      event_type: e.event_type,
      error_message: e.error_message,
      created_at: e.created_at,
    }))

  const errorCount = (by_severity['error'] ?? 0) + (by_severity['fatal'] ?? 0)
  const warnCount = by_severity['warn'] ?? 0
  const status: SummaryStatus = errorCount > 0 || warnCount > 5 ? 'degraded' : 'ok'

  const summary: LogSummary = {
    period: 'last_24h',
    total,
    by_severity,
    by_source,
    recent_errors,
    status,
  }

  return Response.json(summary)
}
