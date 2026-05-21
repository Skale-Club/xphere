'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, RotateCcw, XCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { cancelImport, retryImport, exportImportErrors } from '@/app/(dashboard)/contacts/import-history-actions'
import { StatusPill } from '../page'
import { Button } from '@/components/ui/button'
import type { Database, ContactImportStatus } from '@/types/database'

type ImportRow = Database['public']['Tables']['contact_imports']['Row']
type ImportErrorRow = Database['public']['Tables']['contact_import_errors']['Row']

interface ImportDetailClientProps {
  initialImport: ImportRow
  initialErrors: ImportErrorRow[]
  totalErrors: number
}

export function ImportDetailClient({
  initialImport,
  initialErrors,
  totalErrors,
}: ImportDetailClientProps) {
  const [imp, setImp] = React.useState<ImportRow>(initialImport)
  const [cancelling, setCancelling] = React.useState(false)
  const [retrying, setRetrying] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const router = useRouter()

  // IMP-11: Subscribe to Realtime updates for this import
  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`import-progress-${imp.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contact_imports',
          filter: `id=eq.${imp.id}`,
        },
        (payload) => {
          setImp((prev) => ({ ...prev, ...(payload.new as Partial<ImportRow>) }))
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [imp.id])

  const progressPct = imp.total_rows > 0
    ? Math.round((imp.processed_rows / imp.total_rows) * 100)
    : imp.progress_percent

  const isActive = imp.status === 'queued' || imp.status === 'processing'
  const isDone = ['completed', 'partial', 'failed', 'cancelled'].includes(imp.status)
  const canCancel = isActive
  const canRetry = imp.status === 'failed' || imp.status === 'partial' || imp.status === 'cancelled'

  async function handleCancel() {
    setCancelling(true)
    const res = await cancelImport(imp.id)
    setCancelling(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Import cancelled')
  }

  async function handleRetry() {
    setRetrying(true)
    const res = await retryImport(imp.id)
    setRetrying(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Retry import queued')
    router.push(`/contacts/imports/${res.newImportId}`)
  }

  async function handleExportErrors() {
    setExporting(true)
    const res = await exportImportErrors(imp.id)
    setExporting(false)
    if (!res.ok) { toast.error(res.error); return }
    const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `import-errors-${imp.id.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold text-text-primary">{imp.filename}</h1>
          <div className="mt-1 flex items-center gap-3">
            <StatusPill status={imp.status} />
            <span className="text-[12px] text-text-tertiary">
              {new Date(imp.created_at).toLocaleString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canCancel && (
            <Button size="sm" variant="ghost" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
              Cancel
            </Button>
          )}
          {canRetry && totalErrors > 0 && (
            <Button size="sm" variant="secondary" onClick={handleRetry} disabled={retrying}>
              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Retry {totalErrors} failed rows
            </Button>
          )}
          {isDone && totalErrors > 0 && (
            <Button size="sm" variant="ghost" onClick={handleExportErrors} disabled={exporting}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export errors
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="rounded-[10px] border border-border bg-bg-secondary p-5 space-y-4">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-text-secondary">
            {imp.processed_rows.toLocaleString()} / {imp.total_rows.toLocaleString()} rows processed
          </span>
          <span className="font-semibold text-text-primary">{progressPct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-bg-tertiary overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${progressPct}%`,
              backgroundColor: statusColor(imp.status),
            }}
          />
        </div>
        <div className="grid grid-cols-4 gap-3 pt-1">
          <StatCell label="Inserted" value={imp.inserted_rows} color="text-emerald-400" />
          <StatCell label="Updated" value={imp.updated_rows} color="text-blue-400" />
          <StatCell label="Skipped" value={imp.skipped_rows} color="text-text-tertiary" />
          <StatCell label="Errors" value={imp.error_rows} color={imp.error_rows > 0 ? 'text-amber-400' : 'text-text-tertiary'} />
        </div>
        {isActive && (
          <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            <span>Processing in real time…</span>
          </div>
        )}
        {imp.status_message && (
          <p className="text-[12px] text-red-400 bg-red-500/5 rounded px-3 py-2">{imp.status_message}</p>
        )}
      </div>

      {/* Config summary */}
      <div className="rounded-[10px] border border-border-subtle bg-bg-secondary/50 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-[12px]">
        <ConfigItem label="Dedup strategy" value={imp.dedup_strategy?.replace('_', ' ') ?? '|'} />
        <ConfigItem label="Dedup keys" value={(imp.dedup_keys ?? []).join(' → ') || '|'} />
        <ConfigItem label="Default source" value={imp.default_source ?? '|'} />
        <ConfigItem label="Default tags" value={(imp.default_tags ?? []).join(', ') || '|'} />
      </div>

      {/* Error rows */}
      {initialErrors.length > 0 && (
        <div className="rounded-[10px] border border-border overflow-hidden">
          <div className="bg-bg-secondary px-4 py-3 flex items-center justify-between border-b border-border-subtle">
            <span className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
              Error rows ({totalErrors.toLocaleString()})
            </span>
            {totalErrors > 50 && (
              <span className="text-[11px] text-text-tertiary">Showing first 50</span>
            )}
          </div>
          <div className="divide-y divide-border-subtle">
            {initialErrors.map((e) => (
              <ErrorRow key={e.id} error={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-[18px] font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary mt-0.5">{label}</div>
    </div>
  )
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="text-text-primary mt-0.5 capitalize">{value}</div>
    </div>
  )
}

function ErrorRow({ error }: { error: ImportErrorRow }) {
  const raw = (error.raw_row ?? {}) as Record<string, unknown>
  const preview = Object.entries(raw).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')

  return (
    <div className="px-4 py-3 space-y-1">
      <div className="flex items-start justify-between gap-4">
        <span className="text-[11px] font-mono text-text-tertiary">Row {error.row_number}</span>
        <span className="text-[11.5px] text-red-400">{error.message}</span>
      </div>
      {preview && (
        <p className="text-[11px] text-text-tertiary truncate">{preview}</p>
      )}
    </div>
  )
}

function statusColor(status: ContactImportStatus): string {
  if (status === 'completed') return 'rgb(52 211 153)'
  if (status === 'failed') return 'rgb(248 113 113)'
  if (status === 'partial') return 'rgb(251 191 36)'
  if (status === 'cancelled') return 'rgb(100 116 139)'
  return 'var(--accent)'
}
