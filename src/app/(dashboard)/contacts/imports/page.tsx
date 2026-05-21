import { Suspense } from 'react'
import Link from 'next/link'
import { Upload } from 'lucide-react'

import { getImports } from '@/app/(dashboard)/contacts/import-history-actions'
import type { Database, ContactImportStatus } from '@/types/database'

type ImportRow = Database['public']['Tables']['contact_imports']['Row']

export default async function ImportsPage() {
  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Suspense fallback={<div className="text-[13px] text-text-tertiary">Loading imports…</div>}>
        <ImportsList />
      </Suspense>
    </div>
  )
}

async function ImportsList() {
  const result = await getImports()
  if (!result.ok) {
    return (
      <div className="rounded-[10px] border border-border bg-bg-secondary p-6 text-[13px] text-text-tertiary text-center">
        Failed to load imports: {result.error}
      </div>
    )
  }

  if (result.imports.length === 0) {
    return (
      <div className="rounded-[10px] border border-border bg-bg-secondary p-10 text-center">
        <Upload className="h-8 w-8 text-text-tertiary mx-auto mb-3" />
        <p className="text-[14px] font-medium text-text-primary">No imports yet</p>
        <p className="text-[13px] text-text-secondary mt-1">
          Use the Import CSV button on the Contacts page to start your first import.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[12px] border border-border overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border-subtle bg-bg-secondary text-left text-text-tertiary text-[11px] uppercase tracking-wide">
            <th className="px-4 py-3 font-medium">File</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Progress</th>
            <th className="px-4 py-3 font-medium">Rows</th>
            <th className="px-4 py-3 font-medium">Started</th>
            <th className="px-4 py-3 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {result.imports.map((imp) => (
            <ImportListRow key={imp.id} imp={imp} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ImportListRow({ imp }: { imp: ImportRow }) {
  const progressPct = imp.total_rows > 0
    ? Math.round((imp.processed_rows / imp.total_rows) * 100)
    : imp.progress_percent

  const duration = imp.started_at && imp.finished_at
    ? formatDuration(new Date(imp.started_at), new Date(imp.finished_at))
    : imp.started_at && !imp.finished_at
    ? 'Running…'
    : '|'

  return (
    <tr className="hover:bg-bg-secondary/50 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/contacts/imports/${imp.id}`}
          className="font-medium text-text-primary hover:text-accent transition-colors"
        >
          {imp.filename}
        </Link>
        <div className="text-[11px] text-text-tertiary mt-0.5">
          {formatBytes(imp.size_bytes)}
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusPill status={imp.status} />
      </td>
      <td className="px-4 py-3 min-w-[120px]">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressPct}%`,
                backgroundColor: progressBarColor(imp.status),
              }}
            />
          </div>
          <span className="text-[11px] text-text-tertiary w-8 text-right">{progressPct}%</span>
        </div>
      </td>
      <td className="px-4 py-3 text-text-secondary">
        <span className="text-emerald-400">{imp.inserted_rows}</span>
        {' / '}
        <span className="text-blue-400">{imp.updated_rows}</span>
        {' / '}
        <span className="text-text-tertiary">{imp.skipped_rows}</span>
        {imp.error_rows > 0 && (
          <> / <span className="text-amber-400">{imp.error_rows}</span></>
        )}
        <div className="text-[10.5px] text-text-tertiary">ins/upd/skip{imp.error_rows > 0 ? '/err' : ''}</div>
      </td>
      <td className="px-4 py-3 text-text-secondary">
        {imp.started_at ? formatTime(new Date(imp.started_at)) : '|'}
      </td>
      <td className="px-4 py-3 text-text-secondary">
        {duration}
      </td>
    </tr>
  )
}

export function StatusPill({ status }: { status: ContactImportStatus }) {
  const config: Record<ContactImportStatus, { label: string; className: string }> = {
    uploading:  { label: 'Uploading',   className: 'bg-blue-500/15 text-blue-400' },
    parsing:    { label: 'Parsing',     className: 'bg-blue-500/15 text-blue-400' },
    previewing: { label: 'Previewing',  className: 'bg-blue-500/15 text-blue-400' },
    queued:     { label: 'Queued',      className: 'bg-amber-500/15 text-amber-400' },
    processing: { label: 'Processing',  className: 'bg-accent/15 text-accent' },
    completed:  { label: 'Completed',   className: 'bg-emerald-500/15 text-emerald-400' },
    partial:    { label: 'Partial',     className: 'bg-amber-500/15 text-amber-400' },
    failed:     { label: 'Failed',      className: 'bg-red-500/15 text-red-400' },
    cancelled:  { label: 'Cancelled',   className: 'bg-bg-tertiary text-text-tertiary' },
  }
  const { label, className } = config[status] ?? { label: status, className: 'bg-bg-tertiary text-text-tertiary' }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  )
}

function progressBarColor(status: ContactImportStatus): string {
  if (status === 'completed') return 'rgb(52 211 153)' // emerald-400
  if (status === 'failed') return 'rgb(248 113 113)' // red-400
  if (status === 'partial') return 'rgb(251 191 36)' // amber-400
  if (status === 'cancelled') return 'rgb(100 116 139)' // slate
  return 'var(--accent)'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(d: Date): string {
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
