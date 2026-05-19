'use client'

import * as React from 'react'
import { Upload, CheckCircle2, ChevronUp, ChevronDown, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createImportRecord,
  finalizeUpload,
  saveImportConfig,
  dryRunImport,
  enqueueImport,
} from '@/app/(dashboard)/contacts/import-actions'
import { getDefinitions, type CustomFieldDefinitionRow } from '@/app/(dashboard)/settings/custom-fields/actions'
import { CONTACT_FIELDS, type ContactField } from '@/lib/contacts/csv'
import { CONTACT_SOURCES } from '@/lib/contacts/zod-schemas'
import type { ContactImportDedupStrategy } from '@/types/database'
import { cn } from '@/lib/utils'

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB

const CONTACT_FIELD_LABELS: Record<ContactField, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  company: 'Company',
  notes: 'Notes',
  tags: 'Tags',
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  instagram: 'Instagram',
  csv_import: 'CSV import',
  ghl_sync: 'GHL sync',
}

type Stage =
  | 'pick'
  | 'uploading'
  | 'parsing'
  | 'mapping'
  | 'validating'
  | 'preview'
  | 'queued'

interface ParseResult {
  headers: string[]
  previewRows: string[][]
  totalRows: number
  suggestedMapping: Record<string, string | null>
}

interface DryRunResult {
  wouldInsert: number
  wouldUpdate: number
  wouldSkip: number
  wouldError: number
  sampleErrors: string[]
}

export function ImportWizardDialog() {
  const [open, setOpen] = React.useState(false)
  const [stage, setStage] = React.useState<Stage>('pick')
  const [uploadProgress, setUploadProgress] = React.useState(0)
  const [importId, setImportId] = React.useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null)
  const [parseResult, setParseResult] = React.useState<ParseResult | null>(null)
  const [mapping, setMapping] = React.useState<Record<string, string | null>>({})
  const [dedupStrategy, setDedupStrategy] = React.useState<ContactImportDedupStrategy>('skip_existing')
  const [dedupKeys, setDedupKeys] = React.useState<string[]>(['phone', 'email'])
  const [defaultTags, setDefaultTags] = React.useState('')
  const [defaultSource, setDefaultSource] = React.useState<string>('csv_import')
  const [defaultAssignedTo, setDefaultAssignedTo] = React.useState<string>('none')
  const [dryRunResult, setDryRunResult] = React.useState<DryRunResult | null>(null)
  const [customDefs, setCustomDefs] = React.useState<CustomFieldDefinitionRow[]>([])
  const router = useRouter()

  React.useEffect(() => {
    if (!open) return
    getDefinitions({ entity: 'contact', includeArchived: false }).then((res) => {
      if (res.ok) setCustomDefs(res.data)
    })
  }, [open])

  function reset() {
    setStage('pick')
    setUploadProgress(0)
    setImportId(null)
    setCurrentUserId(null)
    setParseResult(null)
    setMapping({})
    setDedupStrategy('skip_existing')
    setDedupKeys(['phone', 'email'])
    setDefaultTags('')
    setDefaultSource('csv_import')
    setDefaultAssignedTo('none')
    setDryRunResult(null)
  }

  async function handleFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      toast.error('CSV must be under 50 MB')
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Only CSV files are supported')
      return
    }

    const res = await createImportRecord(file.name, file.size)
    if (!res.ok) {
      toast.error(res.error)
      return
    }

    setImportId(res.importId)
    setCurrentUserId(res.currentUserId)
    setStage('uploading')
    setUploadProgress(0)

    // XHR upload for real byte-level progress (IMP-02)
    const xhr = new XMLHttpRequest()
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setStage('parsing')
        const parseRes = await finalizeUpload(res.importId)
        if (!parseRes.ok) {
          toast.error(parseRes.error)
          setStage('pick')
          return
        }
        setParseResult(parseRes)
        setMapping(parseRes.suggestedMapping)
        setStage('mapping')
      } else {
        toast.error(`Upload failed (HTTP ${xhr.status})`)
        setStage('pick')
      }
    }

    xhr.onerror = () => {
      toast.error('Upload failed — network error')
      setStage('pick')
    }

    xhr.open('PUT', res.signedUrl, true)
    xhr.setRequestHeader('Content-Type', file.type || 'text/csv')
    xhr.send(file)
  }

  async function handleValidate() {
    if (!importId) return
    setStage('validating')

    const saveRes = await saveImportConfig(importId, {
      mapping,
      dedupStrategy,
      dedupKeys,
      defaultTags: defaultTags ? defaultTags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      defaultSource,
      defaultAssignedTo: defaultAssignedTo === 'none' ? null : defaultAssignedTo,
    })
    if (!saveRes.ok) {
      toast.error(saveRes.error)
      setStage('mapping')
      return
    }

    const dryRes = await dryRunImport(importId)
    if (!dryRes.ok) {
      toast.error(dryRes.error)
      setStage('mapping')
      return
    }
    setDryRunResult(dryRes)
    setStage('preview')
  }

  async function handleStart() {
    if (!importId) return
    const res = await enqueueImport(importId)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setStage('queued')
    router.refresh()
  }

  function moveDedup(key: string, dir: -1 | 1) {
    setDedupKeys((prev) => {
      const idx = prev.indexOf(key)
      if (idx < 0) return prev
      const next = [...prev]
      const swap = idx + dir
      if (swap < 0 || swap >= next.length) return prev
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next
    })
  }

  const mappedFields = Object.values(mapping).filter(Boolean) as string[]
  const hasPhone = mappedFields.includes('phone')
  const hasEmail = mappedFields.includes('email')
  const canStart = hasPhone || hasEmail

  const stepLabel = { pick: 1, uploading: 1, parsing: 1, mapping: 2, validating: 3, preview: 3, queued: 4 }[stage]

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="h-3.5 w-3.5" /> Import CSV
      </Button>
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            Up to 50 MB · 200,000 rows · dedup by phone or email
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        {stage !== 'queued' && (
          <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
            {['Upload', 'Map', 'Validate', 'Done'].map((label, i) => (
              <React.Fragment key={label}>
                <span className={cn(stepLabel === i + 1 ? 'text-accent font-semibold' : '')}>{label}</span>
                {i < 3 && <span className="mx-1">›</span>}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ── Stage: pick ── */}
        {stage === 'pick' && (
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-3 rounded-[10px]',
              'border-2 border-dashed border-border bg-bg-secondary/40 py-12 px-6 text-center',
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) handleFile(f)
            }}
          >
            <Upload className="h-6 w-6 text-text-tertiary" />
            <div>
              <p className="text-[13.5px] font-medium text-text-primary">Drop a CSV here</p>
              <p className="text-[12px] text-text-tertiary">Up to 50 MB · UTF-8 encoding</p>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              id="import-wizard-file"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
            <Button asChild size="sm" variant="secondary">
              <label htmlFor="import-wizard-file" className="cursor-pointer">
                Choose file
              </label>
            </Button>
          </div>
        )}

        {/* ── Stage: uploading ── */}
        {stage === 'uploading' && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full bg-accent transition-all duration-150"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-[13px] text-text-secondary">Uploading… {uploadProgress}%</p>
          </div>
        )}

        {/* ── Stage: parsing ── */}
        {stage === 'parsing' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <p className="text-[13px] text-text-secondary">Reading file…</p>
          </div>
        )}

        {/* ── Stage: mapping ── */}
        {stage === 'mapping' && parseResult && (
          <div className="flex flex-col gap-5">
            <div className="text-[12px] text-text-secondary">
              <strong className="text-text-primary">{parseResult.totalRows.toLocaleString()}</strong> rows ·{' '}
              <strong className="text-text-primary">{parseResult.headers.length}</strong> columns detected
            </div>

            {/* Column mapping */}
            <Section title="Column mapping">
              <div className="divide-y divide-border-subtle">
                {parseResult.headers.map((h) => (
                  <div key={h} className="grid grid-cols-2 items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 truncate text-[12.5px] text-text-primary">{h}</div>
                    <Select
                      value={mapping[h] ?? 'ignore'}
                      onValueChange={(v) =>
                        setMapping((prev) => ({ ...prev, [h]: v === 'ignore' ? null : v }))
                      }
                    >
                      <SelectTrigger className="h-8 text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ignore">Skip</SelectItem>
                        {CONTACT_FIELDS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {CONTACT_FIELD_LABELS[f as ContactField]}
                          </SelectItem>
                        ))}
                        {customDefs.length > 0 && (
                          <>
                            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-tertiary">
                              Custom fields
                            </div>
                            {customDefs.map((def) => (
                              <SelectItem key={def.id} value={`cf:${def.key}`}>
                                {def.label}
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {!canStart && (
                <p className="px-3 pb-2 text-[11.5px] text-amber-400">
                  Map at least one of Phone or Email to enable import.
                </p>
              )}
            </Section>

            {/* CSV preview */}
            <Section title={`Preview (first ${parseResult.previewRows.length} rows)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="text-left text-text-tertiary">
                    <tr>
                      {parseResult.headers.map((h) => (
                        <th key={h} className="px-3 py-2 font-medium truncate max-w-[140px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {parseResult.previewRows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 text-text-primary truncate max-w-[140px]">
                            {cell || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* Dedup config */}
            <Section title="Deduplication">
              <div className="space-y-3 px-3 pb-3">
                <div className="space-y-1">
                  <label className="text-[11.5px] text-text-secondary">Strategy</label>
                  <Select
                    value={dedupStrategy}
                    onValueChange={(v) => setDedupStrategy(v as ContactImportDedupStrategy)}
                  >
                    <SelectTrigger className="h-9 text-[12.5px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip_existing">Skip existing contacts</SelectItem>
                      <SelectItem value="update_existing">Update existing (non-empty fields win)</SelectItem>
                      <SelectItem value="create_duplicate">Create duplicates</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11.5px] text-text-secondary">Match keys (drag to reorder priority)</label>
                  <div className="flex flex-col gap-1">
                    {dedupKeys.map((key, idx) => (
                      <div
                        key={key}
                        className="flex items-center gap-2 rounded-[8px] border border-border bg-bg-secondary px-3 py-2 text-[12.5px] text-text-primary"
                      >
                        <span className="flex-1 capitalize">{key}</span>
                        <button
                          onClick={() => moveDedup(key, -1)}
                          disabled={idx === 0}
                          className="rounded p-0.5 hover:bg-bg-tertiary disabled:opacity-30"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => moveDedup(key, 1)}
                          disabled={idx === dedupKeys.length - 1}
                          className="rounded p-0.5 hover:bg-bg-tertiary disabled:opacity-30"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setDedupKeys((prev) => prev.filter((k) => k !== key))}
                          className="rounded p-0.5 hover:bg-bg-tertiary text-text-tertiary"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {['phone', 'email'].filter((k) => !dedupKeys.includes(k)).map((k) => (
                      <button
                        key={k}
                        onClick={() => setDedupKeys((prev) => [...prev, k])}
                        className="text-left text-[12px] text-accent hover:underline px-1"
                      >
                        + Add {k}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* Row defaults */}
            <Section title="Row defaults">
              <div className="space-y-3 px-3 pb-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11.5px] text-text-secondary">Source</label>
                    <Select value={defaultSource} onValueChange={setDefaultSource}>
                      <SelectTrigger className="h-9 text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTACT_SOURCES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {SOURCE_LABELS[s] ?? s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11.5px] text-text-secondary">Assign to</label>
                    <Select value={defaultAssignedTo} onValueChange={setDefaultAssignedTo}>
                      <SelectTrigger className="h-9 text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {currentUserId && (
                          <SelectItem value={currentUserId}>Myself</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11.5px] text-text-secondary">
                    Default tags <span className="text-text-tertiary">(comma-separated)</span>
                  </label>
                  <Input
                    value={defaultTags}
                    onChange={(e) => setDefaultTags(e.target.value)}
                    placeholder="imported, newsletter, ..."
                    className="h-9 text-[12.5px]"
                  />
                </div>
              </div>
            </Section>

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setOpen(false); reset() }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleValidate} disabled={!canStart}>
                Validate {parseResult.totalRows > 1000 ? '(first 1,000 rows)' : `(${parseResult.totalRows} rows)`}
              </Button>
            </div>
          </div>
        )}

        {/* ── Stage: validating ── */}
        {stage === 'validating' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <p className="text-[13px] text-text-secondary">Running dry-run validation…</p>
          </div>
        )}

        {/* ── Stage: preview (dry-run results) ── */}
        {stage === 'preview' && dryRunResult && (
          <div className="flex flex-col gap-5">
            <p className="text-[13px] text-text-secondary">
              Dry-run complete on{' '}
              <strong className="text-text-primary">
                {(dryRunResult.wouldInsert + dryRunResult.wouldUpdate + dryRunResult.wouldSkip + dryRunResult.wouldError).toLocaleString()}
              </strong>{' '}
              rows (first 1,000).
              {(parseResult?.totalRows ?? 0) > 1000 && ' Remaining rows will be processed with the same logic.'}
            </p>

            <div className="grid grid-cols-4 gap-3">
              <DryRunStat label="Insert" value={dryRunResult.wouldInsert} tone="success" />
              <DryRunStat label="Update" value={dryRunResult.wouldUpdate} tone="info" />
              <DryRunStat label="Skip" value={dryRunResult.wouldSkip} tone="muted" />
              <DryRunStat label="Error" value={dryRunResult.wouldError} tone={dryRunResult.wouldError > 0 ? 'warning' : 'muted'} />
            </div>

            {dryRunResult.sampleErrors.length > 0 && (
              <div className="rounded-[8px] border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
                <p className="text-[11.5px] font-medium text-amber-400">Sample errors</p>
                {dryRunResult.sampleErrors.map((e, i) => (
                  <p key={i} className="text-[11px] text-text-secondary">{e}</p>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStage('mapping')}>
                ← Back to mapping
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setOpen(false); reset() }}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleStart}
                  disabled={!canStart}
                  title={!canStart ? 'Map at least one of Phone or Email to start' : undefined}
                >
                  Start import
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Stage: queued ── */}
        {stage === 'queued' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="text-[15px] font-semibold text-text-primary">Import queued</h3>
            <p className="text-[13px] text-text-secondary max-w-xs">
              Your file is queued for processing. New contacts will appear shortly.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="ghost" onClick={reset}>Import another</Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-border-subtle overflow-hidden">
      <div className="bg-bg-secondary px-3 py-2 text-[11px] uppercase tracking-wide text-text-tertiary">
        {title}
      </div>
      {children}
    </div>
  )
}

function DryRunStat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'info' | 'muted' | 'warning' }) {
  const color =
    tone === 'success' ? 'text-emerald-400'
    : tone === 'info' ? 'text-blue-400'
    : tone === 'warning' ? 'text-amber-400'
    : 'text-text-secondary'
  return (
    <div className="rounded-[8px] border border-border-subtle bg-bg-secondary p-3 text-center">
      <div className={cn('text-[20px] font-semibold tabular-nums', color)}>{value.toLocaleString()}</div>
      <div className="text-[11px] uppercase tracking-wide text-text-tertiary mt-0.5">{label}</div>
    </div>
  )
}
