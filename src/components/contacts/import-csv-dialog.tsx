'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Upload, CheckCircle2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { previewCsv, importContactsCsv } from '@/app/(dashboard)/contacts/actions'
import { CONTACT_FIELDS, type ContactField } from '@/lib/contacts/csv'
import { cn } from '@/lib/utils'

type Stage = 'pick' | 'mapping' | 'importing' | 'done'

const FIELD_LABEL: Record<ContactField, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  company: 'Company',
  notes: 'Notes',
  tags: 'Tags',
}

export function ImportCsvDialog() {
  const [open, setOpen] = React.useState(false)
  const [stage, setStage] = React.useState<Stage>('pick')
  const [csvText, setCsvText] = React.useState('')
  const [preview, setPreview] = React.useState<{
    headers: string[]
    rows: string[][]
    totalRows: number
  } | null>(null)
  const [mapping, setMapping] = React.useState<Record<string, ContactField | null>>({})
  const [summary, setSummary] = React.useState<{
    inserted: number
    skipped: number
    errors: number
  } | null>(null)
  const router = useRouter()

  function reset() {
    setStage('pick')
    setCsvText('')
    setPreview(null)
    setMapping({})
    setSummary(null)
  }

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('CSV must be under 5MB')
      return
    }
    const text = await file.text()
    setCsvText(text)
    const res = await previewCsv(text)
    if (res.error || !res.preview) {
      toast.error(res.error ?? 'Failed to read CSV')
      return
    }
    setPreview({
      headers: res.preview.headers,
      rows: res.preview.rows,
      totalRows: res.preview.totalRows,
    })
    setMapping(res.preview.suggestedMapping)
    setStage('mapping')
  }

  async function handleImport() {
    setStage('importing')
    const res = await importContactsCsv(csvText, mapping)
    if (res.error) {
      toast.error(res.error)
      setStage('mapping')
      return
    }
    setSummary({
      inserted: res.summary?.inserted ?? 0,
      skipped: res.summary?.skipped ?? 0,
      errors: res.summary?.errors ?? 0,
    })
    setStage('done')
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Upload className="h-3.5 w-3.5" /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file. We'll preview the first rows, let you map columns, and dedup by phone before importing.
          </DialogDescription>
        </DialogHeader>

        {stage === 'pick' && (
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-3 rounded-[10px]',
              'border-2 border-dashed border-border bg-bg-secondary/40 py-12 px-6 text-center',
            )}
          >
            <Upload className="h-6 w-6 text-text-tertiary" />
            <div>
              <p className="text-[13.5px] font-medium text-text-primary">Drop a CSV here</p>
              <p className="text-[12px] text-text-tertiary">Up to 5MB · UTF-8 encoding</p>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              id="csv-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
            <Button asChild size="sm" variant="secondary">
              <label htmlFor="csv-file-input" className="cursor-pointer">
                Choose file
              </label>
            </Button>
          </div>
        )}

        {stage === 'mapping' && preview && (
          <div className="flex flex-col gap-4">
            <div className="text-[12px] text-text-secondary">
              Detected <strong className="text-text-primary">{preview.totalRows}</strong> rows ·{' '}
              <strong className="text-text-primary">{preview.headers.length}</strong> columns. Map each
              column to a contact field, or leave it as "Ignore".
            </div>

            <div className="rounded-[10px] border border-border-subtle overflow-hidden">
              <div className="bg-bg-secondary px-3 py-2 text-[11px] uppercase tracking-wide text-text-tertiary">
                Column mapping
              </div>
              <div className="divide-y divide-border-subtle">
                {preview.headers.map((h) => (
                  <div key={h} className="grid grid-cols-2 items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 truncate text-[12.5px] text-text-primary">{h}</div>
                    <Select
                      value={mapping[h] ?? 'ignore'}
                      onValueChange={(v) =>
                        setMapping((prev) => ({
                          ...prev,
                          [h]: v === 'ignore' ? null : (v as ContactField),
                        }))
                      }
                    >
                      <SelectTrigger className="h-8 text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ignore">Ignore</SelectItem>
                        {CONTACT_FIELDS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {FIELD_LABEL[f]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[10px] border border-border-subtle overflow-hidden">
              <div className="bg-bg-secondary px-3 py-2 text-[11px] uppercase tracking-wide text-text-tertiary">
                Preview (first 5 rows)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="text-left text-text-tertiary">
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h} className="px-3 py-2 font-medium truncate max-w-[140px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {preview.rows.map((r, idx) => (
                      <tr key={idx}>
                        {r.map((cell, cIdx) => (
                          <td key={cIdx} className="px-3 py-2 text-text-primary truncate max-w-[140px]">
                            {cell || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
              <Button onClick={handleImport}>Import {preview.totalRows} rows</Button>
            </div>
          </div>
        )}

        {stage === 'importing' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-bg-tertiary">
              <div className="h-full w-1/3 animate-pulse bg-accent" />
            </div>
            <p className="text-[13px] text-text-secondary">Importing contacts…</p>
          </div>
        )}

        {stage === 'done' && summary && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="text-[15px] font-semibold text-text-primary">Import complete</h3>
            <div className="grid grid-cols-3 gap-4 mt-2">
              <Stat label="Inserted" value={summary.inserted} tone="success" />
              <Stat label="Skipped" value={summary.skipped} tone="muted" />
              <Stat label="Errors" value={summary.errors} tone={summary.errors > 0 ? 'warning' : 'muted'} />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="ghost" onClick={reset}>
                Import another
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'muted' | 'warning'
}) {
  const color =
    tone === 'success'
      ? 'text-emerald-400'
      : tone === 'warning'
      ? 'text-amber-400'
      : 'text-text-secondary'
  return (
    <div className="flex flex-col items-center">
      <div className={cn('text-[22px] font-semibold tabular-nums', color)}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</div>
    </div>
  )
}
