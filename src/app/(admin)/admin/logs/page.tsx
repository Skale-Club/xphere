import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Bug, CheckCircle2, Clock3, Database, Search, XCircle } from 'lucide-react'
import { getUser } from '@/lib/supabase/server'
import {
  getPlatformLogs,
  LOG_PERIODS,
  LOG_SEVERITIES,
  LOG_STATUSES,
  type AdminLogEntry,
  type AdminLogFilters,
  type LogSeverity,
  type LogStatus,
} from './_actions/get-platform-logs'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function readFilters(params: Record<string, string | string[] | undefined>): AdminLogFilters {
  return {
    tenant: firstParam(params.tenant),
    severity: firstParam(params.severity),
    status: firstParam(params.status),
    source: firstParam(params.source),
    period: firstParam(params.period),
    q: firstParam(params.q),
    page: firstParam(params.page),
  }
}

function buildHref(filters: AdminLogFilters, patch: AdminLogFilters): string {
  const params = new URLSearchParams()
  const merged = { ...filters, ...patch }

  for (const [key, value] of Object.entries(merged)) {
    if (!value || value === 'all' || (key === 'page' && value === '1')) continue
    params.set(key, value)
  }

  const query = params.toString()
  return query ? `/admin/logs?${query}` : '/admin/logs'
}

function formatTime(ts: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ts))
}

function severityClasses(severity: LogSeverity): string {
  switch (severity) {
    case 'fatal':
    case 'error':
      return 'border-red-500/30 bg-red-500/10 text-red-300'
    case 'warn':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    case 'info':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
    case 'debug':
    default:
      return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
  }
}

function statusClasses(status: LogStatus): string {
  switch (status) {
    case 'failed':
      return 'border-red-500/30 bg-red-500/10 text-red-300'
    case 'retried':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    case 'skipped':
      return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
    case 'ok':
    default:
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  }
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-secondary px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">{label}</p>
        <Icon className="h-4 w-4 text-text-tertiary" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-text-primary">{value.toLocaleString()}</p>
    </div>
  )
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

function TenantLabel({ log }: { log: AdminLogEntry }) {
  if (!log.org_id) {
    return <Badge className="border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300">Platform</Badge>
  }

  return (
    <div className="min-w-0">
      <p className="truncate text-sm text-text-primary">{log.org_name ?? 'Unknown tenant'}</p>
      <p className="truncate font-mono text-[11px] text-text-tertiary">{log.org_id}</p>
    </div>
  )
}

function PayloadDetails({ log }: { log: AdminLogEntry }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-medium text-accent transition-colors hover:text-text-primary">
        Inspect
      </summary>
      <div className="mt-3 grid gap-3 rounded-md border border-border-subtle bg-bg-primary p-3">
        {log.error_message && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-red-300">Error</p>
            <pre className="whitespace-pre-wrap break-words text-xs text-red-200">{log.error_message}</pre>
          </div>
        )}
        {log.error_stack && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-tertiary">Stack</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-text-secondary">{log.error_stack}</pre>
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-tertiary">Payload</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-text-secondary">
            {JSON.stringify(log.payload ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </details>
  )
}

export default async function AdminLogsPage({ searchParams }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')
  if (!process.env.PLATFORM_ADMIN_EMAIL || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    redirect('/dashboard')
  }

  const rawParams = await searchParams
  const requestedFilters = readFilters(rawParams)
  const data = await getPlatformLogs(requestedFilters)
  const filtersForHref: AdminLogFilters = {
    tenant: data.filters.tenant,
    severity: data.filters.severity,
    status: data.filters.status,
    source: data.filters.source,
    period: data.filters.period,
    q: data.filters.q,
    page: String(data.filters.page),
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Operational Logs</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Cross-tenant platform events, errors, webhooks, and action-engine diagnostics
          </p>
        </div>
        <Link
          href="/admin/activity"
          className="inline-flex h-9 items-center justify-center rounded-md border border-border-subtle px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          Activity Feed
        </Link>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Filtered events" value={data.stats.total} icon={Database} />
        <StatCard label="Errors" value={data.stats.errors} icon={XCircle} />
        <StatCard label="Warnings" value={data.stats.warnings} icon={AlertTriangle} />
        <StatCard label="Platform" value={data.stats.platform} icon={Bug} />
      </div>

      <form className="mb-5 rounded-lg border border-border-subtle bg-bg-secondary p-3" action="/admin/logs">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-text-tertiary">Tenant</span>
            <select
              name="tenant"
              defaultValue={data.filters.tenant}
              className="h-9 rounded-md border border-border-subtle bg-bg-primary px-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              <option value="all">All tenants</option>
              <option value="platform">Platform only</option>
              {data.orgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-text-tertiary">Severity</span>
            <select
              name="severity"
              defaultValue={data.filters.severity}
              className="h-9 rounded-md border border-border-subtle bg-bg-primary px-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              <option value="all">All severities</option>
              {LOG_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>{severity}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-text-tertiary">Status</span>
            <select
              name="status"
              defaultValue={data.filters.status}
              className="h-9 rounded-md border border-border-subtle bg-bg-primary px-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              <option value="all">All statuses</option>
              {LOG_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-text-tertiary">Source</span>
            <select
              name="source"
              defaultValue={data.filters.source}
              className="h-9 rounded-md border border-border-subtle bg-bg-primary px-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              <option value="all">All sources</option>
              {data.sources.map((source) => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-text-tertiary">Period</span>
            <select
              name="period"
              defaultValue={data.filters.period}
              className="h-9 rounded-md border border-border-subtle bg-bg-primary px-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              {LOG_PERIODS.map((period) => (
                <option key={period} value={period}>{period}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-text-tertiary">Search</span>
            <div className="flex h-9 items-center rounded-md border border-border-subtle bg-bg-primary px-2 focus-within:border-accent">
              <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              <input
                name="q"
                defaultValue={data.filters.q}
                placeholder="event, source, error"
                className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </div>
          </label>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <Link
            href="/admin/logs"
            className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            Reset
          </Link>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
          >
            Apply filters
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-secondary">
        {data.logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <CheckCircle2 className="mb-3 h-8 w-8 text-emerald-400" />
            <p className="text-sm font-medium text-text-primary">No log entries match these filters</p>
            <p className="mt-1 text-sm text-text-secondary">Try a longer period or remove one of the filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="border-b border-border-subtle bg-bg-tertiary/50">
                <tr>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-tertiary">Time</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-tertiary">Tenant</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-tertiary">Severity</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-tertiary">Status</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-tertiary">Source</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-tertiary">Event</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-tertiary">Duration</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-tertiary">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.logs.map((log) => (
                  <tr key={log.id} className="align-top transition-colors hover:bg-bg-tertiary/50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-secondary">
                      <div className="flex items-center gap-2">
                        <Clock3 className="h-3.5 w-3.5 text-text-tertiary" />
                        {formatTime(log.created_at)}
                      </div>
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      <TenantLabel log={log} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={severityClasses(log.severity)}>{log.severity}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={statusClasses(log.status)}>{log.status}</Badge>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-text-secondary">{log.source}</td>
                    <td className="max-w-[240px] truncate px-4 py-3 font-mono text-xs text-text-primary">{log.event_type}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-secondary">
                      {log.duration_ms == null ? '-' : `${log.duration_ms}ms`}
                    </td>
                    <td className="min-w-[220px] px-4 py-3">
                      <PayloadDetails log={log} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between">
        <p>
          Page {data.pagination.page.toLocaleString()} of {data.pagination.pageCount.toLocaleString()} · {data.pagination.total.toLocaleString()} events
        </p>
        <div className="flex items-center gap-2">
          <Link
            aria-disabled={data.pagination.page <= 1}
            href={data.pagination.page <= 1 ? buildHref(filtersForHref, { page: '1' }) : buildHref(filtersForHref, { page: String(data.pagination.page - 1) })}
            className={`inline-flex h-9 items-center justify-center rounded-md border border-border-subtle px-3 font-medium transition-colors ${
              data.pagination.page <= 1
                ? 'pointer-events-none opacity-40'
                : 'hover:bg-bg-tertiary hover:text-text-primary'
            }`}
          >
            Previous
          </Link>
          <Link
            aria-disabled={data.pagination.page >= data.pagination.pageCount}
            href={data.pagination.page >= data.pagination.pageCount ? buildHref(filtersForHref, { page: String(data.pagination.page) }) : buildHref(filtersForHref, { page: String(data.pagination.page + 1) })}
            className={`inline-flex h-9 items-center justify-center rounded-md border border-border-subtle px-3 font-medium transition-colors ${
              data.pagination.page >= data.pagination.pageCount
                ? 'pointer-events-none opacity-40'
                : 'hover:bg-bg-tertiary hover:text-text-primary'
            }`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  )
}
