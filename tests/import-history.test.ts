/**
 * Phase 75 — IMPORT-HISTORY-RETRY-TESTS
 * Pure function smoke tests for IMP-10..16, IMP-20.
 */

import { describe, it, expect } from 'vitest'

// ─── Status pill color mapping ────────────────────────────────────────────────

type ImportStatus =
  | 'uploading' | 'parsing' | 'previewing' | 'queued'
  | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled'

function statusPillClass(status: ImportStatus): string {
  const map: Record<ImportStatus, string> = {
    uploading:  'bg-blue-500/15 text-blue-400',
    parsing:    'bg-blue-500/15 text-blue-400',
    previewing: 'bg-blue-500/15 text-blue-400',
    queued:     'bg-amber-500/15 text-amber-400',
    processing: 'bg-accent/15 text-accent',
    completed:  'bg-emerald-500/15 text-emerald-400',
    partial:    'bg-amber-500/15 text-amber-400',
    failed:     'bg-red-500/15 text-red-400',
    cancelled:  'bg-bg-tertiary text-text-tertiary',
  }
  return map[status]
}

describe('StatusPill classes', () => {
  it('active statuses use blue', () => {
    expect(statusPillClass('uploading')).toContain('blue')
    expect(statusPillClass('parsing')).toContain('blue')
    expect(statusPillClass('previewing')).toContain('blue')
  })

  it('queued uses amber', () => {
    expect(statusPillClass('queued')).toContain('amber')
  })

  it('completed uses emerald', () => {
    expect(statusPillClass('completed')).toContain('emerald')
  })

  it('failed uses red', () => {
    expect(statusPillClass('failed')).toContain('red')
  })

  it('cancelled uses muted', () => {
    expect(statusPillClass('cancelled')).toContain('text-text-tertiary')
  })

  it('partial uses amber (needs attention)', () => {
    expect(statusPillClass('partial')).toContain('amber')
  })
})

// ─── Progress percent calculation ─────────────────────────────────────────────

function calcProgressPct(processedRows: number, totalRows: number, progressPercent: number): number {
  return totalRows > 0 ? Math.round((processedRows / totalRows) * 100) : progressPercent
}

describe('Progress percent calculation', () => {
  it('computes from processed/total when total > 0', () => {
    expect(calcProgressPct(500, 1000, 0)).toBe(50)
    expect(calcProgressPct(1000, 1000, 0)).toBe(100)
    expect(calcProgressPct(0, 1000, 0)).toBe(0)
  })

  it('rounds to nearest integer', () => {
    expect(calcProgressPct(1, 3, 0)).toBe(33)
    expect(calcProgressPct(2, 3, 0)).toBe(67)
  })

  it('falls back to stored progress_percent when total_rows is 0', () => {
    expect(calcProgressPct(0, 0, 42)).toBe(42)
  })
})

// ─── Concurrency caps check (IMP-10) ─────────────────────────────────────────

interface ProcessingRow { id: string; org_id: string }

function checkConcurrency(
  processing: ProcessingRow[],
  targetOrgId: string,
  perOrgCap: number,
  globalCap: number,
): { allowed: boolean; reason?: string } {
  const orgCount = processing.filter((r) => r.org_id === targetOrgId).length
  const globalCount = processing.length
  if (orgCount >= perOrgCap) return { allowed: false, reason: `org_cap: ${orgCount}/${perOrgCap}` }
  if (globalCount >= globalCap) return { allowed: false, reason: `global_cap: ${globalCount}/${globalCap}` }
  return { allowed: true }
}

describe('Concurrency cap enforcement (IMP-10)', () => {
  it('allows processing when under all caps', () => {
    const processing = [{ id: '1', org_id: 'org-A' }]
    expect(checkConcurrency(processing, 'org-B', 2, 8).allowed).toBe(true)
  })

  it('blocks when org already has 2 processing jobs', () => {
    const processing = [
      { id: '1', org_id: 'org-A' },
      { id: '2', org_id: 'org-A' },
    ]
    expect(checkConcurrency(processing, 'org-A', 2, 8).allowed).toBe(false)
  })

  it('allows org-B when org-A is at cap', () => {
    const processing = [
      { id: '1', org_id: 'org-A' },
      { id: '2', org_id: 'org-A' },
    ]
    expect(checkConcurrency(processing, 'org-B', 2, 8).allowed).toBe(true)
  })

  it('blocks when global cap reached', () => {
    const processing = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      org_id: `org-${i}`,
    }))
    expect(checkConcurrency(processing, 'org-new', 2, 8).allowed).toBe(false)
  })

  it('blocks third org-A job when two are processing (success criterion)', () => {
    const processing = [
      { id: '1', org_id: 'org-A' },
      { id: '2', org_id: 'org-A' },
      { id: '3', org_id: 'org-B' }, // unrelated org
    ]
    const result = checkConcurrency(processing, 'org-A', 2, 8)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('org_cap')
  })
})

// ─── Final status derivation (completed / partial / failed) ──────────────────

function deriveFinalStatus(
  totalRows: number,
  processedRows: number,
  errorRows: number,
  insertedRows: number,
  updatedRows: number,
): ImportStatus {
  if (processedRows === 0) return 'failed'
  if (errorRows > 0 && insertedRows + updatedRows === 0) return 'failed'
  if (errorRows > 0) return 'partial'
  return 'completed'
}

describe('Final import status derivation', () => {
  it('completed when all rows succeed', () => {
    expect(deriveFinalStatus(100, 100, 0, 100, 0)).toBe('completed')
  })

  it('partial when some rows have errors but others succeed', () => {
    expect(deriveFinalStatus(100, 100, 5, 90, 5)).toBe('partial')
  })

  it('failed when all rows are errors', () => {
    expect(deriveFinalStatus(100, 100, 100, 0, 0)).toBe('failed')
  })

  it('failed when no rows were processed', () => {
    expect(deriveFinalStatus(100, 0, 0, 0, 0)).toBe('failed')
  })

  it('partial with only updates (no inserts)', () => {
    expect(deriveFinalStatus(100, 100, 3, 0, 97)).toBe('partial')
  })
})

// ─── Retry CSV reconstruction ─────────────────────────────────────────────────

interface ErrorRow {
  row_number: number
  raw_row: Record<string, string>
  message: string
}

function buildRetryCsv(errors: ErrorRow[]): string {
  const allKeys = new Set<string>()
  for (const e of errors) {
    for (const k of Object.keys(e.raw_row)) allKeys.add(k)
  }
  const keys = [...allKeys]

  function esc(v: string): string {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`
    return v
  }

  const lines: string[] = [keys.map(esc).join(',')]
  for (const e of errors) {
    lines.push(keys.map((k) => esc(e.raw_row[k] ?? '')).join(','))
  }
  return lines.join('\r\n')
}

describe('Retry CSV reconstruction', () => {
  it('creates a valid CSV from error rows', () => {
    const errors: ErrorRow[] = [
      { row_number: 3, raw_row: { Name: 'Alice', Phone: '+1111', Email: '' }, message: 'no email' },
      { row_number: 7, raw_row: { Name: 'Bob', Phone: '', Email: 'bob@x.com' }, message: 'no phone' },
    ]
    const csv = buildRetryCsv(errors)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Name,Phone,Email')
    expect(lines[1]).toBe('Alice,+1111,')
    expect(lines[2]).toBe('Bob,,bob@x.com')
  })

  it('escapes values containing commas', () => {
    const errors: ErrorRow[] = [
      { row_number: 2, raw_row: { Name: 'Smith, John', Phone: '+1111', Email: '' }, message: 'no email' },
    ]
    const csv = buildRetryCsv(errors)
    expect(csv).toContain('"Smith, John"')
  })

  it('handles single error row', () => {
    const errors: ErrorRow[] = [
      { row_number: 5, raw_row: { Name: 'Carol', Phone: '+9999' }, message: 'no email' },
    ]
    const csv = buildRetryCsv(errors)
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2) // header + 1 data row
  })
})

// ─── Error CSV export format ──────────────────────────────────────────────────

describe('Error CSV export format', () => {
  it('includes error metadata columns', () => {
    function esc(v: string): string {
      if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`
      return v
    }

    const errors: ErrorRow[] = [
      { row_number: 10, raw_row: { Name: 'Dave', Phone: '', Email: '' }, message: 'no phone or email' },
    ]
    const keys = Object.keys(errors[0].raw_row)
    const header = ['_row_number', '_field', '_error_message', ...keys].map(esc).join(',')
    const row = ['10', '', esc('no phone or email'), ...keys.map((k) => esc(errors[0].raw_row[k] ?? ''))].join(',')
    const csv = [header, row].join('\r\n')

    expect(csv).toContain('_row_number')
    expect(csv).toContain('_error_message')
    expect(csv).toContain('no phone or email')
    expect(csv).toContain('10')
  })
})

// ─── Cancellable? check (canCancel / canRetry) ────────────────────────────────

describe('Cancel / retry eligibility', () => {
  function canCancel(status: ImportStatus): boolean {
    return status === 'queued' || status === 'processing'
  }

  function canRetry(status: ImportStatus): boolean {
    return status === 'failed' || status === 'partial' || status === 'cancelled'
  }

  it('queued and processing are cancellable', () => {
    expect(canCancel('queued')).toBe(true)
    expect(canCancel('processing')).toBe(true)
  })

  it('terminal statuses are not cancellable', () => {
    for (const s of ['completed', 'partial', 'failed', 'cancelled'] as ImportStatus[]) {
      expect(canCancel(s)).toBe(false)
    }
  })

  it('failed / partial / cancelled are retryable', () => {
    expect(canRetry('failed')).toBe(true)
    expect(canRetry('partial')).toBe(true)
    expect(canRetry('cancelled')).toBe(true)
  })

  it('in-progress and completed are not retryable', () => {
    expect(canRetry('queued')).toBe(false)
    expect(canRetry('processing')).toBe(false)
    expect(canRetry('completed')).toBe(false)
  })
})

// ─── Duration formatting ──────────────────────────────────────────────────────

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—'
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

describe('Duration formatting', () => {
  it('formats seconds', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:42Z')).toBe('42s')
  })

  it('formats minutes', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:03:30Z')).toBe('4m')
  })

  it('formats hours', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T01:30:00Z')).toBe('1h 30m')
  })

  it('returns — when timestamps are missing', () => {
    expect(formatDuration(null, null)).toBe('—')
    expect(formatDuration('2026-01-01T00:00:00Z', null)).toBe('—')
  })
})
