import type { ContactImportStatus } from '@/types/database'

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
