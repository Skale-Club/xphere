import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

export const LOG_PAGE_SIZE = 50

export const LOG_SEVERITIES = ['debug', 'info', 'warn', 'error', 'fatal'] as const
export const LOG_STATUSES = ['ok', 'failed', 'retried', 'skipped'] as const
export const LOG_PERIODS = ['1h', '24h', '7d', '30d'] as const

export type LogSeverity = (typeof LOG_SEVERITIES)[number]
export type LogStatus = (typeof LOG_STATUSES)[number]
export type LogPeriod = (typeof LOG_PERIODS)[number]
export type EventLogRow = Database['public']['Tables']['event_logs']['Row']

export type AdminLogFilters = {
  tenant?: string
  severity?: string
  status?: string
  source?: string
  period?: string
  q?: string
  page?: string
}

export type AdminLogEntry = EventLogRow & {
  org_name: string | null
}

export type AdminLogOrgOption = {
  id: string
  name: string
}

export type AdminLogsResult = {
  logs: AdminLogEntry[]
  orgs: AdminLogOrgOption[]
  sources: string[]
  filters: {
    tenant: string
    severity: LogSeverity | 'all'
    status: LogStatus | 'all'
    source: string
    period: LogPeriod
    q: string
    page: number
  }
  stats: {
    total: number
    errors: number
    warnings: number
    platform: number
  }
  pagination: {
    page: number
    pageSize: number
    pageCount: number
    total: number
  }
}

function isPlatformAdmin(email: string | undefined): boolean {
  return Boolean(email && process.env.PLATFORM_ADMIN_EMAIL && email === process.env.PLATFORM_ADMIN_EMAIL)
}

function normalizeFilters(input: AdminLogFilters): AdminLogsResult['filters'] {
  const severity = LOG_SEVERITIES.includes(input.severity as LogSeverity)
    ? input.severity as LogSeverity
    : 'all'
  const status = LOG_STATUSES.includes(input.status as LogStatus)
    ? input.status as LogStatus
    : 'all'
  const period = LOG_PERIODS.includes(input.period as LogPeriod)
    ? input.period as LogPeriod
    : '24h'
  const parsedPage = Number.parseInt(input.page ?? '1', 10)

  return {
    tenant: input.tenant?.trim() || 'all',
    severity,
    status,
    source: input.source?.trim() || 'all',
    period,
    q: input.q?.trim() || '',
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  }
}

function sinceForPeriod(period: LogPeriod): string {
  const now = Date.now()
  const hours =
    period === '1h' ? 1
    : period === '7d' ? 24 * 7
    : period === '30d' ? 24 * 30
    : 24

  return new Date(now - hours * 60 * 60 * 1000).toISOString()
}

function sanitizeSearch(value: string): string {
  return value.replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Supabase query builders are structurally typed and awkward to express after
// dynamic filters, so this stays intentionally local and typed as any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, filters: AdminLogsResult['filters'], since: string) {
  query = query.gte('created_at', since)

  if (filters.tenant === 'platform') {
    query = query.is('org_id', null)
  } else if (filters.tenant !== 'all') {
    query = query.eq('org_id', filters.tenant)
  }

  if (filters.severity !== 'all') {
    query = query.eq('severity', filters.severity)
  }

  if (filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }

  if (filters.source !== 'all') {
    query = query.eq('source', filters.source)
  }

  const search = sanitizeSearch(filters.q)
  if (search) {
    const pattern = `%${search}%`
    query = query.or(`event_type.ilike.${pattern},source.ilike.${pattern},error_message.ilike.${pattern},actor_id.ilike.${pattern}`)
  }

  return query
}

export async function getPlatformLogs(input: AdminLogFilters = {}): Promise<AdminLogsResult> {
  const user = await getUser()
  if (!isPlatformAdmin(user?.email)) {
    throw new Error('Unauthorized')
  }

  const filters = normalizeFilters(input)
  const since = sinceForPeriod(filters.period)
  const admin = createServiceRoleClient()
  const offset = (filters.page - 1) * LOG_PAGE_SIZE

  const logsQuery = applyFilters(
    admin
      .from('event_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + LOG_PAGE_SIZE - 1),
    filters,
    since,
  )

  const [logsRes, orgsRes, sourcesRes, errorsRes, warningsRes, platformRes] = await Promise.all([
    logsQuery,
    admin.from('organizations').select('id, name').order('name', { ascending: true }),
    admin.from('event_logs').select('source').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    applyFilters(admin.from('event_logs').select('id', { count: 'exact', head: true }).in('severity', ['error', 'fatal']), { ...filters, severity: 'all' }, since),
    applyFilters(admin.from('event_logs').select('id', { count: 'exact', head: true }).eq('severity', 'warn'), { ...filters, severity: 'all' }, since),
    applyFilters(admin.from('event_logs').select('id', { count: 'exact', head: true }).is('org_id', null), { ...filters, tenant: 'all' }, since),
  ])

  if (logsRes.error) {
    throw new Error(logsRes.error.message)
  }

  const orgs = (orgsRes.data ?? []) as AdminLogOrgOption[]
  const orgMap = new Map(orgs.map((org) => [org.id, org.name]))
  const logs = ((logsRes.data ?? []) as EventLogRow[]).map((log) => ({
    ...log,
    org_name: log.org_id ? orgMap.get(log.org_id) ?? null : null,
  }))

  const sources = [...new Set((sourcesRes.data ?? []).map((row) => row.source).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))

  const total = logsRes.count ?? 0

  return {
    logs,
    orgs,
    sources,
    filters,
    stats: {
      total,
      errors: errorsRes.count ?? 0,
      warnings: warningsRes.count ?? 0,
      platform: platformRes.count ?? 0,
    },
    pagination: {
      page: filters.page,
      pageSize: LOG_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / LOG_PAGE_SIZE)),
      total,
    },
  }
}
