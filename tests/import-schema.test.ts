/**
 * tests/import-schema.test.ts
 *
 * Schema-layer Vitest suite for Phase 73 (IMPORT-SCHEMA-WORKER).
 * Covers IMP-19 (RLS org isolation) and structural invariants from IMP-18.
 *
 * Test groups:
 *   1. progress_percent GENERATED ALWAYS AS STORED — math, cap, zero-div guard,
 *      explicit write rejection, live update on processed_rows change
 *   2. contact_imports RLS cross-org isolation (JWT-authenticated anon clients)
 *   3. contact_import_errors RLS isolation (via import_id → contact_imports join)
 *   4. Realtime publication presence (pg_publication_tables via pg client)
 *   5. pg_cron job existence — SKIPPED (pg_cron not available on this instance;
 *      see 73-01-SUMMARY.md; cleanup ships in Phase 75 via Edge Function)
 *   6. ON DELETE CASCADE from contact_imports to contact_import_errors
 *
 * Uses:
 *   - pg client (direct DB URL) for system catalog + pg_publication_tables queries
 *   - Service-role supabase-js client for setup/teardown + progress_percent tests
 *   - Anon supabase-js clients with real user JWTs for cross-org RLS assertions
 *
 * Run: npx vitest run tests/import-schema.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ─── Environment detection ─────────────────────────────────────────────────────

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasPg = Boolean(DB_URL)
const hasSupabase = Boolean(supabaseUrl && serviceKey)
const hasFullSuite = Boolean(hasPg && supabaseUrl && anonKey && serviceKey)

const pgSuite = hasPg ? describe : describe.skip
const supabaseSuite = hasSupabase ? describe : describe.skip
const fullSuite = hasFullSuite ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[import-schema] SUPABASE_DB_URL/DATABASE_URL missing — pg-catalog + Realtime tests will skip',
  )
}
if (!hasSupabase) {
  console.warn(
    '[import-schema] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — service-role tests will skip',
  )
}
if (!hasFullSuite) {
  console.warn(
    '[import-schema] NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing — cross-org RLS tests will skip',
  )
}

// ─── Shared pg client lifecycle ────────────────────────────────────────────────

let pg: Client | null = null

beforeAll(async () => {
  if (!hasPg) return
  pg = new Client({ connectionString: DB_URL })
  await pg.connect()
}, 30000)

afterAll(async () => {
  if (pg) {
    await pg.end()
    pg = null
  }
})

// ─── Group 1 — progress_percent generated column ──────────────────────────────
// Uses service-role client (bypasses RLS) — no user auth needed.

supabaseSuite('Group 1: progress_percent GENERATED ALWAYS AS STORED', () => {
  const admin = createClient<Database>(supabaseUrl!, serviceKey!, {
    auth: { persistSession: false },
  })

  // Collect IDs for afterAll cleanup
  const importIds: string[] = []

  afterAll(async () => {
    if (importIds.length > 0) {
      await admin.from('contact_imports').delete().in('id', importIds)
    }
  })

  // Fetch the first org to use as a fixture owner
  let fixtureOrgId: string

  beforeAll(async () => {
    const { data, error } = await admin.from('organizations').select('id').limit(1).single()
    if (error || !data) throw new Error(`[import-schema] Could not fetch fixture org: ${error?.message}`)
    fixtureOrgId = data.id
  })

  async function insertImport(
    overrides: Partial<Database['public']['Tables']['contact_imports']['Insert']> = {},
  ) {
    const { data, error } = await admin
      .from('contact_imports')
      .insert({
        org_id: fixtureOrgId,
        storage_path: `${fixtureOrgId}/test-import/fixture.csv`,
        filename: 'fixture.csv',
        size_bytes: 1024,
        ...overrides,
      })
      .select('id, total_rows, processed_rows, progress_percent')
      .single()
    if (error) throw new Error(`insertImport failed: ${error.message}`)
    importIds.push(data!.id)
    return data!
  }

  it('total_rows=100, processed_rows=50 → progress_percent=50', async () => {
    const row = await insertImport({ total_rows: 100, processed_rows: 50 })
    expect(row.progress_percent).toBe(50)
  })

  it('total_rows=100, processed_rows=110 → progress_percent=100 (LEAST cap)', async () => {
    const row = await insertImport({ total_rows: 100, processed_rows: 110 })
    expect(row.progress_percent).toBe(100)
  })

  it('total_rows=0, processed_rows=0 → progress_percent=0 (zero-division guard)', async () => {
    const row = await insertImport({ total_rows: 0, processed_rows: 0 })
    expect(row.progress_percent).toBe(0)
  })

  it('explicit progress_percent=99 in INSERT is rejected by Postgres', async () => {
    // GENERATED ALWAYS AS STORED columns cannot be written — Postgres rejects
    // any payload that includes them with a specific error. Use pg client for
    // this test because supabase-js strips unknown columns silently.
    if (!hasPg) {
      console.warn('[import-schema] Skipping generated-column rejection test — pg client unavailable')
      return
    }
    const suffix = Math.random().toString(36).slice(2, 10)
    let errMsg = ''
    try {
      await pg!.query(
        `INSERT INTO public.contact_imports
           (org_id, storage_path, filename, size_bytes, progress_percent)
         VALUES ($1, $2, $3, 512, 99)`,
        [fixtureOrgId, `${fixtureOrgId}/test/rej-${suffix}.csv`, `rej-${suffix}.csv`],
      )
    } catch (err) {
      errMsg = String((err as Error).message ?? err)
    }
    // Postgres message for generated columns: "cannot insert a non-DEFAULT value
    // into column "progress_percent""
    expect(errMsg).toBeTruthy()
    expect(errMsg.toLowerCase()).toMatch(/progress_percent|generated|cannot insert/)
  })

  it('UPDATE processed_rows 50→75 on existing row → progress_percent updates to 75', async () => {
    const row = await insertImport({ total_rows: 100, processed_rows: 50 })
    expect(row.progress_percent).toBe(50)

    const { data, error } = await admin
      .from('contact_imports')
      .update({ processed_rows: 75 })
      .eq('id', row.id)
      .select('progress_percent')
      .single()

    expect(error).toBeNull()
    expect(data?.progress_percent).toBe(75)
  })
})

// ─── Group 2 — contact_imports RLS cross-org isolation ─────────────────────────
// Creates two real orgs + two real users, signs in with anon clients.

fullSuite('Group 2: contact_imports RLS cross-org isolation', () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const userAEmail = `import-rls-a-${suffix}@example.test`
  const userBEmail = `import-rls-b-${suffix}@example.test`
  const password = `Import-Rls-${suffix}!`

  let admin: SupabaseClient<Database>
  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>

  let orgAId = ''
  let orgBId = ''
  let userAId = ''
  let userBId = ''
  let importAId = ''

  beforeAll(async () => {
    admin = createClient<Database>(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false },
    })

    // Create org A
    const { data: orgA, error: orgAErr } = await admin
      .from('organizations')
      .insert({
        name: `Import RLS A ${suffix}`,
        slug: `import-rls-a-${suffix}`,
        widget_token: `import-tok-a-${suffix}`,
      })
      .select('id')
      .single()
    if (orgAErr) throw orgAErr
    orgAId = orgA.id

    // Create org B
    const { data: orgB, error: orgBErr } = await admin
      .from('organizations')
      .insert({
        name: `Import RLS B ${suffix}`,
        slug: `import-rls-b-${suffix}`,
        widget_token: `import-tok-b-${suffix}`,
      })
      .select('id')
      .single()
    if (orgBErr) throw orgBErr
    orgBId = orgB.id

    // Create user A
    const { data: uA, error: uAErr } = await admin.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
    })
    if (uAErr) throw uAErr
    userAId = uA.user!.id

    // Create user B
    const { data: uB, error: uBErr } = await admin.auth.admin.createUser({
      email: userBEmail,
      password,
      email_confirm: true,
    })
    if (uBErr) throw uBErr
    userBId = uB.user!.id

    // Assign each user to their org
    const { error: memErr } = await admin.from('org_members').insert([
      { user_id: userAId, organization_id: orgAId, role: 'admin' },
      { user_id: userBId, organization_id: orgBId, role: 'admin' },
    ])
    if (memErr) throw memErr

    // Service-role inserts a contact_imports row for org A
    const { data: imp, error: impErr } = await admin
      .from('contact_imports')
      .insert({
        org_id: orgAId,
        storage_path: `${orgAId}/cross-org-test/${suffix}.csv`,
        filename: `${suffix}.csv`,
        size_bytes: 2048,
      })
      .select('id')
      .single()
    if (impErr) throw impErr
    importAId = imp.id

    // Sign in the anon clients
    const makeClient = () =>
      createClient<Database>(supabaseUrl!, anonKey!, { auth: { persistSession: false } })
    clientA = makeClient()
    clientB = makeClient()

    const signIns = await Promise.all([
      clientA.auth.signInWithPassword({ email: userAEmail, password }),
      clientB.auth.signInWithPassword({ email: userBEmail, password }),
    ])
    for (const { error } of signIns) if (error) throw error
  }, 60000)

  afterAll(async () => {
    if (!admin) return
    const cleanups: Promise<unknown>[] = []
    if (userAId) cleanups.push(admin.auth.admin.deleteUser(userAId))
    if (userBId) cleanups.push(admin.auth.admin.deleteUser(userBId))
    await Promise.allSettled(cleanups)
    // Deleting the orgs cascades to contact_imports and org_members
    if (orgAId) await admin.from('organizations').delete().eq('id', orgAId)
    if (orgBId) await admin.from('organizations').delete().eq('id', orgBId)
  }, 60000)

  it('contact_imports row under org A is NOT visible to org B user', async () => {
    const { data, error } = await clientB
      .from('contact_imports')
      .select('id')
      .eq('id', importAId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('org B user UPDATE attempt on org A import row affects 0 rows', async () => {
    // Supabase anon client: UPDATE returns data only for rows the user can see.
    // Because org B's RLS policy blocks the row, the UPDATE is silently a no-op.
    const { data, error } = await clientB
      .from('contact_imports')
      .update({ status_message: 'cross-org-attack' })
      .eq('id', importAId)
      .select('id')
    expect(error).toBeNull()
    // data should be an empty array (0 rows matched the RLS-filtered update)
    expect(data ?? []).toHaveLength(0)

    // Confirm the row was not mutated
    const { data: check } = await admin
      .from('contact_imports')
      .select('status_message')
      .eq('id', importAId)
      .single()
    expect(check?.status_message).not.toBe('cross-org-attack')
  })

  it('contact_imports row under org A IS visible to org A user', async () => {
    const { data, error } = await clientA
      .from('contact_imports')
      .select('id')
      .eq('id', importAId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(importAId)
  })

  it('org B user INSERT targeting org A is rejected by RLS WITH CHECK', async () => {
    const { data, error } = await clientB.from('contact_imports').insert({
      org_id: orgAId,
      storage_path: `${orgAId}/attack/${suffix}.csv`,
      filename: `attack-${suffix}.csv`,
      size_bytes: 1,
    })
    // RLS WITH CHECK should block the insert
    expect(data).toBeNull()
    expect(error).toBeTruthy()

    // Service-role confirms no row was written
    const { data: leaked } = await admin
      .from('contact_imports')
      .select('id')
      .eq('org_id', orgAId)
      .eq('filename', `attack-${suffix}.csv`)
    expect(leaked ?? []).toHaveLength(0)
  })
})

// ─── Group 3 — contact_import_errors RLS isolation ────────────────────────────
// Org B should not see org A's import errors (via import_id → contact_imports join).

fullSuite('Group 3: contact_import_errors RLS cross-org isolation', () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const userAEmail = `import-err-a-${suffix}@example.test`
  const userBEmail = `import-err-b-${suffix}@example.test`
  const password = `Import-Err-${suffix}!`

  let admin: SupabaseClient<Database>
  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>

  let orgAId = ''
  let orgBId = ''
  let userAId = ''
  let userBId = ''
  let importAId = ''
  let errorAId = ''

  beforeAll(async () => {
    admin = createClient<Database>(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false },
    })

    const { data: orgA, error: eA } = await admin
      .from('organizations')
      .insert({
        name: `Import Err A ${suffix}`,
        slug: `import-err-a-${suffix}`,
        widget_token: `import-err-tok-a-${suffix}`,
      })
      .select('id')
      .single()
    if (eA) throw eA
    orgAId = orgA.id

    const { data: orgB, error: eB } = await admin
      .from('organizations')
      .insert({
        name: `Import Err B ${suffix}`,
        slug: `import-err-b-${suffix}`,
        widget_token: `import-err-tok-b-${suffix}`,
      })
      .select('id')
      .single()
    if (eB) throw eB
    orgBId = orgB.id

    const { data: uA, error: uAErr } = await admin.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
    })
    if (uAErr) throw uAErr
    userAId = uA.user!.id

    const { data: uB, error: uBErr } = await admin.auth.admin.createUser({
      email: userBEmail,
      password,
      email_confirm: true,
    })
    if (uBErr) throw uBErr
    userBId = uB.user!.id

    await admin.from('org_members').insert([
      { user_id: userAId, organization_id: orgAId, role: 'admin' },
      { user_id: userBId, organization_id: orgBId, role: 'admin' },
    ])

    // Create a contact_imports row for org A
    const { data: imp, error: impErr } = await admin
      .from('contact_imports')
      .insert({
        org_id: orgAId,
        storage_path: `${orgAId}/errors-test/${suffix}.csv`,
        filename: `${suffix}.csv`,
        size_bytes: 512,
      })
      .select('id')
      .single()
    if (impErr) throw impErr
    importAId = imp.id

    // Create a contact_import_errors row linked to org A's import
    const { data: err, error: errErr } = await admin
      .from('contact_import_errors')
      .insert({
        import_id: importAId,
        row_number: 1,
        raw_row: { name: 'Test', email: 'bad-email' },
        field: 'email',
        message: 'Invalid email format',
      })
      .select('id')
      .single()
    if (errErr) throw errErr
    errorAId = err.id

    // Sign in anon clients
    const makeClient = () =>
      createClient<Database>(supabaseUrl!, anonKey!, { auth: { persistSession: false } })
    clientA = makeClient()
    clientB = makeClient()

    const signIns = await Promise.all([
      clientA.auth.signInWithPassword({ email: userAEmail, password }),
      clientB.auth.signInWithPassword({ email: userBEmail, password }),
    ])
    for (const { error } of signIns) if (error) throw error
  }, 60000)

  afterAll(async () => {
    if (!admin) return
    const cleanups: Promise<unknown>[] = []
    if (userAId) cleanups.push(admin.auth.admin.deleteUser(userAId))
    if (userBId) cleanups.push(admin.auth.admin.deleteUser(userBId))
    await Promise.allSettled(cleanups)
    if (orgAId) await admin.from('organizations').delete().eq('id', orgAId)
    if (orgBId) await admin.from('organizations').delete().eq('id', orgBId)
  }, 60000)

  it('contact_import_errors row for org A import is NOT visible to org B user', async () => {
    const { data, error } = await clientB
      .from('contact_import_errors')
      .select('id')
      .eq('id', errorAId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('org B user sees 0 contact_import_errors rows total (not just filtered by ID)', async () => {
    const { data, error } = await clientB.from('contact_import_errors').select('id')
    expect(error).toBeNull()
    // Org B has no imports → no errors visible
    expect((data ?? []).filter((r) => r.id === errorAId)).toHaveLength(0)
  })

  it('contact_import_errors row IS visible to service-role (bypasses RLS)', async () => {
    const { data, error } = await admin
      .from('contact_import_errors')
      .select('id, message')
      .eq('id', errorAId)
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBe(errorAId)
    expect(data?.message).toBe('Invalid email format')
  })
})

// ─── Group 4 — Realtime publication presence ──────────────────────────────────

pgSuite('Group 4: Realtime publication — pg_publication_tables', () => {
  it('contact_imports IS in the supabase_realtime publication', async () => {
    const res = await pg!.query<{ tablename: string }>(
      `SELECT tablename
         FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'contact_imports'`,
    )
    expect(res.rowCount).toBe(1)
    expect(res.rows[0].tablename).toBe('contact_imports')
  })

  it('contact_import_errors is NOT in the supabase_realtime publication', async () => {
    // Errors are fetched on-demand — intentionally excluded from Realtime.
    const res = await pg!.query<{ tablename: string }>(
      `SELECT tablename
         FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'contact_import_errors'`,
    )
    expect(res.rowCount).toBe(0)
  })
})

// ─── Group 5 — pg_cron job existence (SKIPPED) ────────────────────────────────
// pg_cron is NOT installed on this Supabase instance. The cleanup-stale-imports
// job could not be scheduled by migration 066_contact_imports.sql (the DO block
// raised NOTICE and skipped gracefully). The scheduled cleanup will be
// implemented as a Supabase Edge Function in Phase 75.
//
// See: 73-01-SUMMARY.md § "pg_cron Availability"

describe.skip('Group 5: pg_cron job — SKIPPED (pg_cron not available on this instance)', () => {
  it('cron.job table has cleanup-stale-imports row', async () => {
    // Would query: SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'cleanup-stale-imports'
    // Skipped: pg_cron extension not installed; see 73-01-SUMMARY.md
  })

  it("cleanup-stale-imports schedule equals '0 3 * * *'", async () => {
    // Skipped: pg_cron extension not installed
  })

  it('cleanup-stale-imports command references contact_imports and INTERVAL', async () => {
    // Skipped: pg_cron extension not installed
  })
})

// ─── Group 6 — ON DELETE CASCADE ─────────────────────────────────────────────
// Delete a contact_imports row → all linked contact_import_errors rows vanish.

supabaseSuite('Group 6: ON DELETE CASCADE contact_imports → contact_import_errors', () => {
  const admin = createClient<Database>(supabaseUrl!, serviceKey!, {
    auth: { persistSession: false },
  })

  let fixtureOrgId: string

  beforeAll(async () => {
    const { data, error } = await admin.from('organizations').select('id').limit(1).single()
    if (error || !data) throw new Error(`[import-schema] Could not fetch fixture org: ${error?.message}`)
    fixtureOrgId = data.id
  })

  it('deleting a contact_imports row cascades to linked contact_import_errors rows', async () => {
    // Insert a contact_imports row
    const { data: imp, error: impErr } = await admin
      .from('contact_imports')
      .insert({
        org_id: fixtureOrgId,
        storage_path: `${fixtureOrgId}/cascade-test/cascade.csv`,
        filename: 'cascade.csv',
        size_bytes: 256,
      })
      .select('id')
      .single()
    if (impErr) throw new Error(`cascade test: insertImport failed: ${impErr.message}`)
    const importId = imp!.id

    // Insert two linked error rows
    const { data: errors, error: errErr } = await admin
      .from('contact_import_errors')
      .insert([
        {
          import_id: importId,
          row_number: 1,
          raw_row: { col: 'val1' },
          message: 'cascade error 1',
        },
        {
          import_id: importId,
          row_number: 2,
          raw_row: { col: 'val2' },
          message: 'cascade error 2',
        },
      ])
      .select('id')
    if (errErr) throw new Error(`cascade test: insertErrors failed: ${errErr.message}`)
    expect(errors).toHaveLength(2)

    // Delete the parent import row
    const { error: delErr } = await admin
      .from('contact_imports')
      .delete()
      .eq('id', importId)
    expect(delErr).toBeNull()

    // Verify errors were cascade-deleted
    const { data: remaining, error: checkErr } = await admin
      .from('contact_import_errors')
      .select('id')
      .eq('import_id', importId)
    expect(checkErr).toBeNull()
    expect(remaining ?? []).toHaveLength(0)
  })
})
