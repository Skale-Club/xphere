// tests/accounts-schema.test.ts
// Phase 64 Plan 03 — schema-layer regression suite for the accounts table.
//
// Proves three Phase 64 success criteria are testable at the schema layer:
//   * ACC-19 — accounts has RLS enabled with a policy whose USING expression
//              references get_current_org_id(), AND an account created under
//              org A is invisible to an authenticated client signed into org B.
//   * ACC-15 — opp_has_contact_or_account CHECK constraint exists on
//              public.opportunities AND actively rejects inserts with both
//              contact_id IS NULL and account_id IS NULL.
//   * ACC-14 — the data-migration block in supabase/migrations/064_accounts.sql
//              (the distinct_companies CTE + INSERT + UPDATE) is idempotent:
//              re-running it produces zero new accounts rows and does not
//              re-assign existing contacts.account_id values.
//
// Implementation strategy mirrors the two established patterns:
//   * pg_catalog inspection via raw `pg` client  → tests/agent-schema-rls-smoke.test.ts
//   * cross-org isolation via supabase-js anon+JWT → tests/rls-isolation.test.ts
//
// Soft-skip semantics: tests skip cleanly (NOT fail) when DB env vars are
// missing, so CI runs without Supabase credentials stay green.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ─── Environment detection ────────────────────────────────────────────────────

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasPg = Boolean(DB_URL)
const hasSupabase = Boolean(url && anonKey && serviceKey)

const pgSuite = hasPg ? describe : describe.skip
const fullSuite = hasPg && hasSupabase ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[accounts-schema] SUPABASE_DB_URL/DATABASE_URL missing — pg-catalog tests will skip',
  )
}
if (!hasSupabase) {
  console.warn(
    '[accounts-schema] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY missing — cross-org RLS test will skip',
  )
}

// ─── Shared pg client lifecycle ───────────────────────────────────────────────

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

// ─── Test 1 — ACC-19 schema-layer: RLS + policy ──────────────────────────────

pgSuite('ACC-19: accounts table RLS', () => {
  it('public.accounts has relrowsecurity=true', async () => {
    const relRes = await pg!.query<{ relrowsecurity: boolean }>(
      `SELECT c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      ['accounts'],
    )
    expect(relRes.rowCount).toBe(1)
    expect(relRes.rows[0].relrowsecurity).toBe(true)
  })

  it('public.accounts has a policy whose USING expr references get_current_org_id', async () => {
    const polRes = await pg!.query<{ polname: string; using_expr: string | null }>(
      `SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
         FROM pg_policy
        WHERE polrelid = (
          SELECT c.oid
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = $1
        )`,
      ['accounts'],
    )
    expect(polRes.rowCount).toBeGreaterThanOrEqual(1)
    const matches = polRes.rows.filter(
      (r) => r.using_expr?.includes('get_current_org_id') ?? false,
    )
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── Test 2 — ACC-15: opp_has_contact_or_account CHECK constraint ────────────

pgSuite('ACC-15: opportunities CHECK constraint', () => {
  it('opp_has_contact_or_account constraint exists on public.opportunities', async () => {
    const conRes = await pg!.query<{ conname: string; defn: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS defn
         FROM pg_constraint
        WHERE conname = 'opp_has_contact_or_account'
          AND conrelid = 'public.opportunities'::regclass`,
    )
    expect(conRes.rowCount).toBe(1)
    // Postgres' pg_get_constraintdef normalizes the predicate with extra
    // parentheses around each side, e.g.:
    //   CHECK (((contact_id IS NOT NULL) OR (account_id IS NOT NULL)))
    // The substring search ignores those parens to match the canonical form
    // declared in supabase/migrations/064_accounts.sql:
    //   contact_id IS NOT NULL OR account_id IS NOT NULL
    const normalized = conRes.rows[0].defn.replace(/\(|\)/g, '')
    expect(normalized).toContain(
      'contact_id IS NOT NULL OR account_id IS NOT NULL',
    )
  })

  it('inserting an opportunity with both contact_id NULL and account_id NULL is rejected', async () => {
    // Seed prerequisites: throwaway org + pipeline + stage. The pg connection
    // uses the service-role-equivalent (direct) DB URL which bypasses RLS but
    // NOT CHECK constraints — CHECK is row-level integrity, not access control.
    const suffix = Math.random().toString(36).slice(2, 10)
    const orgName = `acc-schema-check-${suffix}`
    let orgId = ''
    let pipelineId = ''
    let stageId = ''

    try {
      const orgRes = await pg!.query<{ id: string }>(
        `INSERT INTO public.organizations (name, slug, widget_token)
         VALUES ($1, $1, $2)
         RETURNING id`,
        [orgName, `wt-${suffix}`],
      )
      orgId = orgRes.rows[0].id

      const pipeRes = await pg!.query<{ id: string }>(
        `INSERT INTO public.pipelines (org_id, name)
         VALUES ($1, 'Test pipeline')
         RETURNING id`,
        [orgId],
      )
      pipelineId = pipeRes.rows[0].id

      const stageRes = await pg!.query<{ id: string }>(
        `INSERT INTO public.pipeline_stages (org_id, pipeline_id, name, position)
         VALUES ($1, $2, 'Lead', 0)
         RETURNING id`,
        [orgId, pipelineId],
      )
      stageId = stageRes.rows[0].id

      let errMsg = ''
      try {
        await pg!.query(
          `INSERT INTO public.opportunities (org_id, pipeline_id, stage_id, title)
           VALUES ($1, $2, $3, $4)`,
          [orgId, pipelineId, stageId, `orphan-${suffix}`],
        )
        throw new Error('orphan insert unexpectedly succeeded')
      } catch (err) {
        errMsg = String((err as Error).message ?? err)
      }

      // Postgres error text contains either the constraint name or the generic
      // "violates check constraint" phrasing. Accept either.
      const matched =
        errMsg.includes('opp_has_contact_or_account') ||
        errMsg.includes('violates check constraint')
      expect(matched).toBe(true)
    } finally {
      // Cascade-cleanup via org delete (pipelines/stages/opportunities cascade).
      if (orgId) {
        await pg!.query(`DELETE FROM public.organizations WHERE id = $1`, [orgId])
      }
    }
  })
})

// ─── Test 3 — ACC-14: data-migration idempotency ──────────────────────────────

pgSuite('ACC-14: contacts.company → accounts data migration is idempotent', () => {
  it('re-running the data-migration block produces zero new accounts rows', async () => {
    const suffix = Math.random().toString(36).slice(2, 10)
    const orgName = `acc-schema-idem-${suffix}`
    let orgId = ''

    try {
      // 1. Seed a throwaway org.
      const orgRes = await pg!.query<{ id: string }>(
        `INSERT INTO public.organizations (name, slug, widget_token)
         VALUES ($1, $1, $2)
         RETURNING id`,
        [orgName, `wt-${suffix}`],
      )
      orgId = orgRes.rows[0].id

      // 2. Insert 5 contacts with company variants:
      //    - 'Acme Corp'     → counts
      //    - '  Acme Corp  ' → trims + dedups with 'Acme Corp'
      //    - 'Beta LLC'      → counts
      //    - ''              → ignored (TRIM(company) <> '')
      //    - NULL            → ignored (company IS NOT NULL)
      //    Expected distinct accounts after migration = 2.
      await pg!.query(
        `INSERT INTO public.contacts (org_id, name, company, source)
         VALUES
           ($1, 'C1', 'Acme Corp',    'manual'),
           ($1, 'C2', '  Acme Corp ', 'manual'),
           ($1, 'C3', 'Beta LLC',     'manual'),
           ($1, 'C4', '',             'manual'),
           ($1, 'C5', NULL,           'manual')`,
        [orgId],
      )

      // 3. First run of the migration block (scoped to this org).
      await runMigrationBlock(pg!, orgId)

      const firstCountRes = await pg!.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.accounts WHERE org_id = $1`,
        [orgId],
      )
      const firstCount = Number(firstCountRes.rows[0].count)
      expect(firstCount).toBe(2)

      // Snapshot the account_id assignments for the contacts so the second
      // run can be checked against them (no contact should be re-linked).
      const firstLinks = await pg!.query<{ name: string; account_id: string | null }>(
        `SELECT name, account_id FROM public.contacts
          WHERE org_id = $1 ORDER BY name`,
        [orgId],
      )
      const firstLinkMap = new Map(
        firstLinks.rows.map((r) => [r.name, r.account_id]),
      )

      // 4. Second run of the migration block.
      await runMigrationBlock(pg!, orgId)

      const secondCountRes = await pg!.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.accounts WHERE org_id = $1`,
        [orgId],
      )
      const secondCount = Number(secondCountRes.rows[0].count)
      expect(secondCount).toBe(firstCount) // zero new rows

      // 5. Verify all 3 non-empty-company contacts have a linked account_id,
      //    no contact got its account_id changed, and the linkage matches by
      //    lower(name).
      const secondLinks = await pg!.query<{
        name: string
        company: string | null
        account_id: string | null
        account_name: string | null
      }>(
        `SELECT c.name, c.company, c.account_id, a.name AS account_name
           FROM public.contacts c
           LEFT JOIN public.accounts a ON a.id = c.account_id
          WHERE c.org_id = $1
          ORDER BY c.name`,
        [orgId],
      )

      for (const row of secondLinks.rows) {
        // Stability: identical link assignment between the two runs.
        expect(row.account_id).toBe(firstLinkMap.get(row.name))

        const trimmed = row.company?.trim() ?? ''
        if (trimmed === '') {
          // Empty / NULL company contacts remain unlinked.
          expect(row.account_id).toBeNull()
        } else {
          // Linked contacts point to the account that matches by lower(name).
          expect(row.account_id).not.toBeNull()
          expect(row.account_name?.toLowerCase()).toBe(trimmed.toLowerCase())
        }
      }

      // Sanity: the source of the auto-created accounts is the canonical value.
      const sourceRes = await pg!.query<{ source: string }>(
        `SELECT source FROM public.accounts WHERE org_id = $1`,
        [orgId],
      )
      for (const r of sourceRes.rows) {
        expect(r.source).toBe('auto_from_contact_company')
      }
    } finally {
      if (orgId) {
        await pg!.query(`DELETE FROM public.organizations WHERE id = $1`, [orgId])
      }
    }
  })
})

// Runs the migration-064 data-migration block (sections "Step 1+2" and
// "Step 3" from supabase/migrations/064_accounts.sql), scoped to a single org
// so the test stays isolated from real data.
async function runMigrationBlock(client: Client, orgId: string): Promise<void> {
  // Step 1+2: distinct TRIM(company) per org → INSERT accounts (skip already-present).
  await client.query(
    `WITH distinct_companies AS (
       SELECT org_id, TRIM(company) AS name
         FROM public.contacts
        WHERE company IS NOT NULL
          AND TRIM(company) <> ''
          AND org_id = $1
        GROUP BY org_id, TRIM(company)
     )
     INSERT INTO public.accounts (org_id, name, source, created_at, updated_at)
     SELECT dc.org_id, dc.name, 'auto_from_contact_company', now(), now()
       FROM distinct_companies dc
      WHERE NOT EXISTS (
        SELECT 1 FROM public.accounts a
         WHERE a.org_id = dc.org_id AND lower(a.name) = lower(dc.name)
      )`,
    [orgId],
  )

  // Step 3: link contacts.account_id where still NULL.
  await client.query(
    `UPDATE public.contacts c
        SET account_id = a.id
       FROM public.accounts a
      WHERE a.org_id = c.org_id
        AND lower(TRIM(c.company)) = lower(a.name)
        AND c.account_id IS NULL
        AND c.org_id = $1`,
    [orgId],
  )
}

// ─── Test 4 — ACC-19 cross-org reality: anon-client isolation ────────────────

fullSuite('ACC-19: accounts cross-org isolation', () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const userAEmail = `acc-rls-a-${suffix}@example.test`
  const userBEmail = `acc-rls-b-${suffix}@example.test`
  const password = `Acc-Rls-${suffix}!`

  let admin: SupabaseClient<Database>
  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>

  let orgAId = ''
  let orgBId = ''
  let userAId = ''
  let userBId = ''
  let accountAId = ''

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!, {
      auth: { persistSession: false },
    })

    const { data: orgA, error: orgAErr } = await admin
      .from('organizations')
      .insert({
        name: `Acc RLS A ${suffix}`,
        slug: `acc-rls-a-${suffix}`,
        widget_token: `acc-rls-tok-a-${suffix}`,
      })
      .select('id')
      .single()
    if (orgAErr) throw orgAErr
    orgAId = orgA.id

    const { data: orgB, error: orgBErr } = await admin
      .from('organizations')
      .insert({
        name: `Acc RLS B ${suffix}`,
        slug: `acc-rls-b-${suffix}`,
        widget_token: `acc-rls-tok-b-${suffix}`,
      })
      .select('id')
      .single()
    if (orgBErr) throw orgBErr
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

    const { error: memErr } = await admin.from('org_members').insert([
      { user_id: userAId, organization_id: orgAId, role: 'admin' },
      { user_id: userBId, organization_id: orgBId, role: 'admin' },
    ])
    if (memErr) throw memErr

    // Service-role inserts an account into org A. We will probe its visibility
    // via the two anon clients below.
    const { data: acc, error: accErr } = await admin
      .from('accounts')
      .insert({
        org_id: orgAId,
        name: `CrossOrg Test ${suffix}`,
        source: 'manual',
      })
      .select('id')
      .single()
    if (accErr) throw accErr
    accountAId = acc.id

    const makeClient = () =>
      createClient<Database>(url!, anonKey!, { auth: { persistSession: false } })
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

  it('account inserted under org A is not visible to a user signed into org B', async () => {
    const { data, error } = await clientB
      .from('accounts')
      .select('id, name')
      .eq('id', accountAId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('account inserted under org A IS visible to a user signed into org A', async () => {
    const { data, error } = await clientA
      .from('accounts')
      .select('id, name')
      .eq('id', accountAId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(accountAId)
  })

  it('user signed into org B cannot insert an account targeting org A (WITH CHECK)', async () => {
    const { data, error } = await clientB.from('accounts').insert({
      org_id: orgAId,
      name: `Cross-tenant attack ${suffix}`,
      source: 'manual',
    })
    expect(data).toBeNull()
    expect(error).toBeTruthy()

    // Service-role confirms no row was written.
    const { data: check } = await admin
      .from('accounts')
      .select('id')
      .eq('org_id', orgAId)
      .eq('name', `Cross-tenant attack ${suffix}`)
    expect(check ?? []).toHaveLength(0)
  })
})
