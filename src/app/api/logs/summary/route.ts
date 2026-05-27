// src/app/api/logs/summary/route.ts
// AI Logs Summary endpoint — returns an aggregated snapshot of event_logs
// for the last 24 hours. Operational logs are platform-admin only.
//
// Intended for AI agents, dashboards, and monitoring tools to quickly
// assess system health without reading raw log entries.

export const runtime = 'nodejs'

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'

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

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.PLATFORM_ADMIN_EMAIL || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceRoleClient()
  const { searchParams } = new URL(request.url)
  const tenant = searchParams.get('tenant')?.trim() || 'all'

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Fetch all logs from the last 24h through the trusted platform-admin path.
  let query = supabase
    .from('event_logs')
    .select('event_type, source, severity, status, error_message, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (tenant === 'platform') {
    query = query.is('org_id', null)
  } else if (tenant !== 'all') {
    query = query.eq('org_id', tenant)
  }

  const { data: logs, error } = await query

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
