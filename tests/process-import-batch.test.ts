import { describe, it, expect } from 'vitest'
import { processImport, type ImportDeps } from '@/lib/import/process-import'
import { processImport as processImportRowwise } from './helpers/process-import-rowwise'
import { IMPORT_CHUNK_SIZE } from '@/lib/import/import-batch'

// A small stateful fake of the tables the import touches. Contacts enforce the
// production unique indexes (org+phone, org+email); emails in `badEmails` always
// fail to insert. Every awaited query is counted.

interface Opts {
  contacts?: Array<Record<string, unknown>>
  accounts?: Array<Record<string, unknown>>
  badEmails?: string[]
  failMultiInsert?: boolean
  cancelAfterStatusChecks?: number
}

function like(pattern: string, value: string): boolean {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') { re += (pattern[i + 1] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++ }
    else if (ch === '%') re += '.*'
    else if (ch === '_') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i').test(value)
}

function makeDb(o: Opts = {}) {
  const contacts: Array<Record<string, unknown>> = (o.contacts ?? []).map((c) => ({ ...c }))
  const accounts: Array<Record<string, unknown>> = (o.accounts ?? []).map((c) => ({ ...c }))
  const errors: Array<Record<string, unknown>> = []
  const importUpdates: Array<Record<string, unknown>> = []
  const calls: Array<{ table: string; op: string }> = []
  let statusChecks = 0
  let seq = 0

  const violates = (row: Record<string, unknown>, selfId?: unknown) =>
    contacts.some(
      (c) =>
        c.id !== selfId &&
        ((row.phone && c.phone === row.phone) || (row.email && c.email === row.email)),
    )

  function builder(table: string) {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update',
      cols: '', payload: undefined as unknown, eq: {} as Record<string, unknown>,
      inn: {} as Record<string, unknown[]>, ilike: undefined as string | undefined, or: undefined as string | undefined,
      single: false,
    }
    const exec = (): { data: unknown; error: { message: string } | null } => {
      calls.push({ table, op: st.op })
      if (table === 'contact_imports') {
        if (st.op === 'select') {
          statusChecks++
          const cancelled = o.cancelAfterStatusChecks !== undefined && statusChecks > o.cancelAfterStatusChecks
          return { data: { status: cancelled ? 'cancelled' : 'processing' }, error: null }
        }
        importUpdates.push(st.payload as Record<string, unknown>)
        return { data: null, error: null }
      }
      if (table === 'contact_import_errors') {
        for (const e of ([] as unknown[]).concat(st.payload)) errors.push(e as Record<string, unknown>)
        return { data: null, error: null }
      }
      if (table === 'contacts') {
        if (st.op === 'select') {
          const col = Object.keys(st.inn)[0]
          const vals = st.inn[col]
          return { data: contacts.filter((c) => vals.includes(c[col])).map((c) => ({ id: c.id, [col]: c[col] })), error: null }
        }
        if (st.op === 'insert') {
          const rows = ([] as Array<Record<string, unknown>>).concat(st.payload as never)
          if (rows.length > 1 && o.failMultiInsert) return { data: null, error: { message: 'batch boom' } }
          const staged: Array<Record<string, unknown>> = []
          for (const r of rows) {
            const bad = (r.email && o.badEmails?.includes(r.email as string)) ||
              violates(r) || staged.some((s) => (r.phone && s.phone === r.phone) || (r.email && s.email === r.email))
            if (bad) return { data: null, error: { message: 'duplicate key value violates unique constraint' } }
            staged.push({ ...r, id: `c${++seq}` })
          }
          contacts.push(...staged)
          return { data: st.single ? { id: staged[0].id } : staged.map((s) => ({ id: s.id })), error: null }
        }
        // update
        const patch = st.payload as Record<string, unknown>
        const ids = st.eq.id !== undefined ? [st.eq.id] : (st.inn.id ?? [])
        const targets = contacts.filter((c) => ids.includes(c.id))
        for (const t of targets) if (violates({ ...t, ...patch }, t.id)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } }
        for (const t of targets) Object.assign(t, patch)
        return { data: null, error: null }
      }
      if (table === 'accounts') {
        if (st.op === 'select') {
          const pats = st.ilike !== undefined
            ? [st.ilike]
            : [...(st.or ?? '').matchAll(/name\.ilike\."((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))
          const hit = accounts.filter((a) => pats.some((p) => like(p, String(a.name))))
          if (st.single) return hit[0] ? { data: { id: hit[0].id }, error: null } : { data: null, error: { message: 'no rows' } }
          return { data: hit.map((a) => ({ id: a.id, name: a.name })), error: null }
        }
        const rows = ([] as Array<Record<string, unknown>>).concat(st.payload as never)
        const made = rows.map((r) => ({ ...r, id: `a${++seq}` }))
        accounts.push(...made)
        return { data: st.single ? { id: made[0].id } : made.map((m) => ({ id: m.id, name: m.name })), error: null }
      }
      return { data: null, error: null }
    }
    const q: Record<string, unknown> = {
      select(c?: string) { if (st.op === 'select') st.cols = c ?? ''; return q },
      insert(p: unknown) { st.op = 'insert'; st.payload = p; return q },
      update(p: unknown) { st.op = 'update'; st.payload = p; return q },
      eq(c: string, v: unknown) { st.eq[c] = v; return q },
      in(c: string, v: unknown[]) { st.inn[c] = v; return q },
      ilike(_c: string, v: string) { st.ilike = v; return q },
      or(v: string) { st.or = v; return q },
      limit() { return q },
      single() { st.single = true; return Promise.resolve(exec()) },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(exec()).then(res, rej) },
    }
    return q
  }
  const db = { from: (t: string) => builder(t) }
  return { db: db as never, contacts, accounts, errors, importUpdates, calls, statusChecks: () => statusChecks }
}

const importRow = (over: Record<string, unknown> = {}) => ({
  id: 'imp-1', org_id: 'org-1', storage_path: 'p',
  mapping: { Name: 'name', Phone: 'phone', Email: 'email', Company: 'company', Tags: 'tags' },
  dedup_strategy: 'skip_existing', dedup_keys: ['phone', 'email'],
  default_tags: ['t1'], default_source: null, default_assigned_to: null,
  ...over,
})

const deps = (csv: string): ImportDeps => ({
  download: async () => ({ data: new Blob([csv]), error: null }),
  fetchSigned: async () => new Response(csv),
  defer: () => {},
  env: {},
  now: () => '2026-01-01T00:00:00.000Z',
})

const csvOf = (lines: string[]) => ['Name,Phone,Email,Company,Tags', ...lines].join('\n') + '\n'

type Impl = typeof processImport

async function run(impl: Impl, csv: string, o: Opts, row = importRow()) {
  const t = makeDb(o)
  await impl(t.db, row, null, deps(csv))
  const final = [...t.importUpdates].reverse().find((u) => u.status)
  const progress = [...t.importUpdates].reverse().find((u) => 'processed_rows' in u)
  return {
    ...t,
    final,
    progress,
    errRows: t.errors.map((e) => `${e.row_number}:${e.field}:${e.message}`),
    contactKeys: t.contacts.map((c) => `${c.phone ?? '-'}|${c.email ?? '-'}|${c.name ?? '-'}|${c.company ?? '-'}`),
  }
}

// new, existing (by phone and by email), in-chunk duplicate (email and phone), invalid, bad row
const MIXED = csvOf([
  'Ada,+15550000001,ada@x.com,Acme,vip',        // 2 new
  'Bob,,bob@x.com,Acme Inc,',                   // 3 new
  'Existing Phone,+15550000009,,,',             // 4 existing by phone
  'Existing Mail,,old@x.com,,',                 // 5 existing by email
  'Ada Again,+15550000002,ada@x.com,,',         // 6 in-chunk dup of row 2 (email)
  'Nobody,,,,',                                 // 7 invalid
  'Bad,,bad@x.com,,',                           // 8 insert rejected by the DB
  'Cy,+15550000001,,,',                         // 9 in-chunk dup of row 2 (phone)
  'Dee,+15550000004,dee@x.com,ACME,',           // 10 new, company matches case-insensitively
])
const SEED = {
  contacts: [
    { id: 'e1', phone: '+15550000009', email: null, name: 'Old Phone' },
    { id: 'e2', phone: null, email: 'old@x.com', name: 'Old Mail' },
  ],
  badEmails: ['bad@x.com'],
}

describe('process-import batching', () => {
  for (const dedup of ['skip_existing', 'update_existing', 'create_duplicate']) {
    it(`matches row-by-row on a mixed fixture (${dedup})`, async () => {
      const row = importRow({ dedup_strategy: dedup })
      const a = await run(processImportRowwise, MIXED, SEED, row)
      const b = await run(processImport, MIXED, SEED, row)

      expect(b.progress).toEqual(a.progress)
      expect(b.final).toEqual(a.final)
      expect(b.errRows).toEqual(a.errRows)
      expect(b.contactKeys.sort()).toEqual(a.contactKeys.sort())
      expect(b.accounts.map((x) => x.name)).toEqual(a.accounts.map((x) => x.name))
      // every contact with a company is linked to the same account as before
      const linked = (t: typeof a) =>
        t.contacts.filter((c) => c.company).map((c) => `${c.company}->${t.accounts.find((x) => x.id === c.account_id)?.name}`).sort()
      expect(linked(b)).toEqual(linked(a))
      expect(b.calls.length).toBeLessThan(a.calls.length)
    })
  }

  it('pins the counters of the mixed fixture', async () => {
    const r = await run(processImport, MIXED, SEED)
    expect(r.progress).toMatchObject({ processed_rows: 9, inserted_rows: 3, updated_rows: 0, skipped_rows: 2, error_rows: 4 })
    expect(r.final).toMatchObject({ status: 'partial' })
    // row 6 (same email as row 2) and row 9 (same phone) fail like before, row 7 has no key, row 8 is rejected
    expect(r.errRows).toEqual([
      '6:null:Insert failed',
      '7:phone_or_email:Row has no phone or email — cannot identify contact for dedup',
      '8:null:Insert failed',
      '9:null:Insert failed',
    ])
  })

  it('falls back to row-by-row when the batch insert fails, keeping the good rows', async () => {
    const csv = csvOf(['A,+15550000011,a@x.com,,', 'B,+15550000012,b@x.com,,', 'C,+15550000013,c@x.com,,'])
    const r = await run(processImport, csv, { failMultiInsert: true })
    expect(r.progress).toMatchObject({ inserted_rows: 3, error_rows: 0 })
    expect(r.final).toMatchObject({ status: 'completed' })
    const inserts = r.calls.filter((c) => c.table === 'contacts' && c.op === 'insert').length
    expect(inserts).toBe(1 + 3) // the failed batch, then one per row

    const withBad = await run(processImport, csvOf(['A,,a@x.com,,', 'B,,bad@x.com,,', 'C,,c@x.com,,']), { badEmails: ['bad@x.com'] })
    expect(withBad.progress).toMatchObject({ inserted_rows: 2, error_rows: 1 })
    expect(withBad.errRows).toEqual(['3:null:Insert failed'])
    expect(withBad.final).toMatchObject({ status: 'partial' })
  })

  it('shares one statement between updates with an identical patch', async () => {
    // Both rows match an existing contact by email and carry the same patch (tags only).
    const csv = csvOf([',,a@x.com,,', ',,b@x.com,,'])
    const seed = { contacts: [{ id: 'e1', email: 'a@x.com' }, { id: 'e2', email: 'b@x.com' }] }
    const r = await run(processImport, csv, seed, importRow({ dedup_strategy: 'update_existing' }))
    expect(r.progress).toMatchObject({ updated_rows: 2, error_rows: 0 })
    expect(r.calls.filter((c) => c.table === 'contacts' && c.op === 'update')).toHaveLength(1)
  })

  it('matches row-by-row for updates that hit the same contact twice or collide on a key', async () => {
    const csv = csvOf([
      'First,+15550000020,old@x.com,,',   // update e2, sets a new phone
      'Second,,old@x.com,,',              // update e2 again: last name wins
      'Third,+15550000020,new@x.com,,',   // phone now taken by e2: insert fails
      'Fourth,+15550000009,,,',           // update e1
      'Fifth,+15550000009,mine@x.com,,',  // update e1, sets email
    ])
    const row = importRow({ dedup_strategy: 'update_existing' })
    const a = await run(processImportRowwise, csv, SEED, row)
    const b = await run(processImport, csv, SEED, row)
    expect(b.progress).toEqual(a.progress)
    expect(b.final).toEqual(a.final)
    expect(b.errRows).toEqual(a.errRows)
    expect(b.contactKeys.sort()).toEqual(a.contactKeys.sort())
  })

  it('stops between chunks when cancelled, with the first chunk already written', async () => {
    const lines = Array.from({ length: IMPORT_CHUNK_SIZE + 5 }, (_, i) => `N${i},+1555${String(i).padStart(7, '0')},,,`)
    const r = await run(processImport, csvOf(lines), { cancelAfterStatusChecks: 1 })
    expect(r.progress).toMatchObject({ processed_rows: IMPORT_CHUNK_SIZE, inserted_rows: IMPORT_CHUNK_SIZE })
    expect(r.contacts).toHaveLength(IMPORT_CHUNK_SIZE)
    expect(r.importUpdates.some((u) => 'finished_at' in u)).toBe(false)
    expect(r.statusChecks()).toBe(2)
  })

  it('keeps the number of database calls bounded per chunk (1,000 rows)', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) =>
      `N${i},+1555${String(i).padStart(7, '0')},n${i}@x.com,Co${i % 50},`)
    const csv = csvOf(lines)
    const before = await run(processImportRowwise, csv, {})
    const after = await run(processImport, csv, {})
    const count = (t: typeof after) => t.calls.length

    expect(after.progress).toEqual(before.progress)
    expect(after.progress).toMatchObject({ processed_rows: 1000, inserted_rows: 1000, error_rows: 0 })
    expect(after.contacts.length).toBe(1000)
    expect(after.accounts).toHaveLength(50)
    // eslint-disable-next-line no-console
    console.log(`1,000-row fixture DB calls: row-by-row ${count(before)}, batched ${count(after)}`)

    const chunks = Math.ceil(1000 / IMPORT_CHUNK_SIZE)
    // per chunk: status check + 2 lookups (100 values each -> 5 pages) + insert + account lookups
    // (50 names -> 1) + account insert + link updates (<= 50) + progress update
    expect(count(after)).toBeLessThanOrEqual(2 + chunks * (1 + 10 + 1 + 1 + 1 + 50 + 1))
    expect(after.calls.filter((c) => c.table === 'contacts' && c.op === 'insert')).toHaveLength(chunks)
    expect(after.calls.filter((c) => c.table === 'accounts' && c.op === 'insert')).toHaveLength(1)
    expect(after.calls.filter((c) => c.table === 'contact_imports' && c.op === 'update')).toHaveLength(2 + chunks)
  })
})
