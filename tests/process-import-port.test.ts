import { describe, it, expect, vi } from 'vitest'
import { fakeDb, writes, type FakeCall, type Reply } from './helpers/fake-db'
import { startImportJob, parseCsv } from '@/lib/import/process-import'
import { runsInApp, functionsRunningInApp } from '@/lib/edge-functions/switch'

const CSV = 'Name,Phone,Email\nAda Lovelace,+15551230001,ada@example.com\nBob,,\n'
const CSV_OK = 'Name,Phone,Email\nAda Lovelace,+15551230001,ada@example.com\n'

const importRow = {
  id: 'imp-1',
  org_id: 'org-1',
  storage_path: 'org-1/imp-1/file.csv',
  mapping: { Name: 'name', Phone: 'phone', Email: 'email' },
  dedup_strategy: 'skip_existing',
  dedup_keys: ['phone', 'email'],
  default_tags: ['t1'],
  default_source: null,
  default_assigned_to: null,
}

interface Opts {
  csv?: string | null
  processing?: Array<{ id: string; org_id: string }>
  queuedRow?: typeof importRow | null
  claimOk?: boolean
  cancelled?: boolean
  insertError?: boolean
}

function setup(o: Opts = {}) {
  const csv = o.csv === undefined ? CSV_OK : o.csv
  const respond = (c: FakeCall): Reply | undefined => {
    if (c.table === 'contact_imports') {
      if (c.op === 'select' && c.columns === 'id, org_id') return { data: o.processing ?? [] }
      if (c.op === 'select' && c.columns === '*') return { data: o.queuedRow === undefined ? importRow : o.queuedRow }
      if (c.op === 'select' && c.columns === 'status') return { data: { status: o.cancelled ? 'cancelled' : 'processing' } }
      if (c.op === 'update' && (c.payload as { status?: string })?.status === 'processing') {
        return { data: o.claimOk === false ? null : { id: 'imp-1' } }
      }
    }
    if (c.table === 'contacts' && c.op === 'insert') {
      return o.insertError ? { error: { message: 'boom' } } : { data: { id: 'contact-1' } }
    }
    if (c.table === 'contacts' && c.op === 'select') return { data: [] }
    return undefined
  }
  const { db, calls } = fakeDb(respond)
  const deferred: Array<() => Promise<unknown>> = []
  const download = vi.fn(async () =>
    csv === null
      ? { data: null, error: { message: 'not found' } }
      : { data: new Blob([csv]), error: null },
  )
  const fetchSigned = vi.fn(async () => new Response(csv ?? '', { status: 200 }))
  const overrides = {
    download,
    fetchSigned,
    defer: (w: () => Promise<unknown>) => { deferred.push(w) },
    env: { R2_ENDPOINT: 'https://files.example.com' } as Record<string, string | undefined>,
    now: () => '2026-01-01T00:00:00.000Z',
  }
  const run = async () => { for (const w of deferred) await w() }
  return { db, calls, deferred, download, fetchSigned, overrides, run }
}

const statusUpdates = (calls: FakeCall[]) =>
  writes(calls, 'contact_imports', 'update').map((c) => c.payload as Record<string, unknown>)

describe('process-imports in-app port', () => {
  it('claims queued -> processing, answers at once, and defers the row work', async () => {
    const t = setup()
    const res = await startImportJob(t.db, { importId: 'imp-1' }, t.overrides)

    expect(res).toEqual({ status: 200, body: { ok: true, importId: 'imp-1', message: 'Processing started' } })
    const claim = writes(t.calls, 'contact_imports', 'update')[0]
    expect(claim.payload).toMatchObject({ status: 'processing' })
    expect(claim.filters).toContainEqual(['status', 'eq', 'queued'])
    // Nothing has been inserted yet: the work is deferred
    expect(writes(t.calls, 'contacts', 'insert')).toHaveLength(0)
    expect(t.deferred).toHaveLength(1)

    await t.run()
    expect(writes(t.calls, 'contacts', 'insert')).toHaveLength(1)
    const updates = statusUpdates(t.calls)
    expect(updates.some((u) => u.total_rows === 1)).toBe(true)
    expect(updates.some((u) => u.inserted_rows === 1 && u.processed_rows === 1)).toBe(true)
    expect(updates[updates.length - 1]).toMatchObject({ status: 'completed' })
  })

  it('is idempotent: a second start that loses the claim does nothing', async () => {
    const t = setup({ claimOk: false })
    const res = await startImportJob(t.db, { importId: 'imp-1' }, t.overrides)
    expect(res.body.message).toBe('Claimed by concurrent worker')
    expect(t.deferred).toHaveLength(0)
  })

  it('skips an import that is not queued, and a call with no import id', async () => {
    const none = setup({ queuedRow: null })
    expect((await startImportJob(none.db, { importId: 'imp-1' }, none.overrides)).body.message).toBe(
      'Import not found or not queued',
    )
    expect(none.deferred).toHaveLength(0)

    const noId = setup()
    const res = await startImportJob(noId.db, {}, noId.overrides)
    expect(res.status).toBe(200)
    expect(noId.calls).toHaveLength(0)
  })

  it('leaves the job queued when the per-org or global cap is reached', async () => {
    const perOrg = setup({ processing: [{ id: 'a', org_id: 'org-1' }, { id: 'b', org_id: 'org-1' }] })
    expect((await startImportJob(perOrg.db, { importId: 'imp-1' }, perOrg.overrides)).body.message).toBe(
      'Capacity full — job stays queued',
    )
    expect(statusUpdates(perOrg.calls)).toHaveLength(0)

    const many = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, org_id: `o${i}` }))
    const global = setup({ processing: many })
    expect((await startImportJob(global.db, { importId: 'imp-1' }, global.overrides)).body.message).toBe(
      'Capacity full — job stays queued',
    )
  })

  it('marks the import failed with a message when the CSV cannot be read', async () => {
    const t = setup({ csv: null })
    await startImportJob(t.db, { importId: 'imp-1' }, t.overrides)
    await t.run()
    const last = statusUpdates(t.calls).pop()!
    expect(last.status).toBe('failed')
    expect(String(last.status_message)).toContain('CSV could not be read')
    expect(last.finished_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('ends partial and records an error row when some rows have no phone or email', async () => {
    const t = setup({ csv: CSV })
    await startImportJob(t.db, { importId: 'imp-1' }, t.overrides)
    await t.run()
    const errors = writes(t.calls, 'contact_import_errors', 'insert')
    expect(errors).toHaveLength(1)
    expect(errors[0].payload).toMatchObject({ import_id: 'imp-1', row_number: 3, field: 'phone_or_email' })
    expect(statusUpdates(t.calls).pop()).toMatchObject({ status: 'partial' })
  })

  it('ends failed when every row errors', async () => {
    const t = setup({ insertError: true })
    await startImportJob(t.db, { importId: 'imp-1' }, t.overrides)
    await t.run()
    expect(statusUpdates(t.calls).pop()).toMatchObject({ status: 'failed' })
  })

  it('stops without a final status when the import was cancelled', async () => {
    const t = setup({ cancelled: true })
    await startImportJob(t.db, { importId: 'imp-1' }, t.overrides)
    await t.run()
    expect(writes(t.calls, 'contacts', 'insert')).toHaveLength(0)
    expect(statusUpdates(t.calls).some((u) => 'finished_at' in u)).toBe(false)
  })

  it('uses a trusted R2 signed URL and ignores an untrusted one (SSRF)', async () => {
    const trusted = setup()
    await startImportJob(trusted.db, { importId: 'imp-1', downloadUrl: 'https://acct.r2.cloudflarestorage.com/x?sig=1' }, trusted.overrides)
    await trusted.run()
    expect(trusted.fetchSigned).toHaveBeenCalledTimes(1)
    expect(trusted.download).not.toHaveBeenCalled()

    const evil = setup()
    await startImportJob(evil.db, { importId: 'imp-1', downloadUrl: 'https://169.254.169.254/latest/meta-data' }, evil.overrides)
    await evil.run()
    expect(evil.fetchSigned).not.toHaveBeenCalled()
    expect(evil.download).toHaveBeenCalledWith('contact-imports', 'org-1/imp-1/file.csv')

    const plainHttp = setup()
    await startImportJob(plainHttp.db, { importId: 'imp-1', downloadUrl: 'http://acct.r2.cloudflarestorage.com/x' }, plainHttp.overrides)
    await plainHttp.run()
    expect(plainHttp.fetchSigned).not.toHaveBeenCalled()
  })

  it('falls back to storage when the signed URL answers an error', async () => {
    const t = setup()
    t.fetchSigned.mockResolvedValueOnce(new Response('', { status: 403 }))
    await startImportJob(t.db, { importId: 'imp-1', downloadUrl: 'https://acct.r2.cloudflarestorage.com/x' }, t.overrides)
    await t.run()
    expect(t.download).toHaveBeenCalledTimes(1)
    expect(statusUpdates(t.calls).pop()).toMatchObject({ status: 'completed' })
  })

  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,b\n"x,1","he said ""hi"""\n')).toEqual({ headers: ['a', 'b'], rows: [['x,1', 'he said "hi"']] })
  })
})

describe('EDGE_FUNCTIONS_IN_APP switch', () => {
  it('defaults to the Edge Function path (nothing in-app)', () => {
    expect(functionsRunningInApp({}).size).toBe(0)
    expect(runsInApp('process-imports', {})).toBe(false)
    expect(runsInApp('process-imports', { EDGE_FUNCTIONS_IN_APP: '' })).toBe(false)
  })

  it('lists only what is named', () => {
    const env = { EDGE_FUNCTIONS_IN_APP: ' process-imports , push-sender' }
    expect(runsInApp('process-imports', env)).toBe(true)
    expect(runsInApp('push-sender', env)).toBe(true)
    expect(runsInApp('process-embeddings', env)).toBe(false)
  })
})
