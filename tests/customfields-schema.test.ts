// tests/customfields-schema.test.ts
// Phase 68 Plan 03 — schema-layer regression suite for custom_field_definitions.
//
// Proves the four Phase 68 success criteria and both phase requirements:
//   * SC3 + SC4 (CF-11/CF-14 indirectly) — custom_field_type ENUM has all
//        13 values in order; custom_field_entity ENUM has exactly
//        contact/opportunity/account (pipelines/stages intentionally absent).
//   * SC1 (CF-14) — custom_field_definitions has RLS enabled with a policy
//        whose USING expression references get_current_org_id(), AND a
//        definition created under org A is invisible to a user signed
//        into org B.
//   * SC2 (CF-11) — the reserved-key CHECK constraint
//        custom_field_definitions_key_not_reserved rejects inserts whose
//        key collides with either the universal reserved set or any of
//        the per-entity native-column sets.
//
// Implementation strategy mirrors tests/accounts-schema.test.ts:
//   * pg_catalog inspection via raw `pg` client
//   * cross-org isolation via supabase-js anon+JWT
// Soft-skip semantics: tests skip cleanly (NOT fail) when DB env vars
// are missing, so CI runs without Supabase credentials stay green.

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
    '[customfields-schema] SUPABASE_DB_URL/DATABASE_URL missing — pg-catalog tests will skip',
  )
}
if (!hasSupabase) {
  console.warn(
    '[customfields-schema] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY missing — cross-org RLS test will skip',
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

// ─── Test 1 — SC3 + SC4: ENUM contents ────────────────────────────────────────

// LOCKED ENUM expectations (must match migration 065 byte-for-byte).
// Inlined on single lines so the plan's verify regex catches drift.
// prettier-ignore
const EXPECTED_TYPE_ENUM = ['text','long_text','number','integer','boolean','date','datetime','select','multi_select','url','email','phone','currency']
// prettier-ignore
const EXPECTED_ENTITY_ENUM = ['contact','opportunity','account']

pgSuite('SC3+SC4: custom field ENUMs', () => {
  it('custom_field_type ENUM exists with all 13 values in the migration-defined order', async () => {
    const res = await pg!.query<{ enumlabel: string }>(
      `SELECT enumlabel
         FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = $1)
        ORDER BY enumsortorder`,
      ['custom_field_type'],
    )
    expect(res.rowCount).toBe(13)
    expect(res.rows.map((r) => r.enumlabel)).toEqual(EXPECTED_TYPE_ENUM)
  })

  it('custom_field_entity ENUM exists with exactly 3 values: contact, opportunity, account', async () => {
    const res = await pg!.query<{ enumlabel: string }>(
      `SELECT enumlabel
         FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = $1)
        ORDER BY enumsortorder`,
      ['custom_field_entity'],
    )
    expect(res.rowCount).toBe(3)
    const labels = res.rows.map((r) => r.enumlabel)
    expect(labels).toEqual(EXPECTED_ENTITY_ENUM)

    // Negative check for SC4: pipelines/stages are intentionally absent.
    // SEED-017 §"Reserved for future milestones" explicitly defers per-pipeline
    // custom fields, so the ENUM must not include either label.
    expect(labels).not.toContain('pipeline')
    expect(labels).not.toContain('stage')
  })
})

// ─── Test 2 — SC1 schema-layer (CF-14): RLS enabled + canonical policy ───────

pgSuite('SC1 (CF-14) schema: custom_field_definitions RLS', () => {
  it('public.custom_field_definitions has relrowsecurity=true', async () => {
    const relRes = await pg!.query<{ relrowsecurity: boolean }>(
      `SELECT c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      ['custom_field_definitions'],
    )
    expect(relRes.rowCount).toBe(1)
    expect(relRes.rows[0].relrowsecurity).toBe(true)
  })

  it('public.custom_field_definitions has a policy whose USING expr references get_current_org_id', async () => {
    const polRes = await pg!.query<{ polname: string; using_expr: string | null }>(
      `SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
         FROM pg_policy
        WHERE polrelid = (
          SELECT c.oid
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = $1
        )`,
      ['custom_field_definitions'],
    )
    expect(polRes.rowCount).toBeGreaterThanOrEqual(1)

    // At least one policy's USING expression mentions the canonical helper.
    const usingMatches = polRes.rows.filter(
      (r) => r.using_expr?.includes('get_current_org_id') ?? false,
    )
    expect(usingMatches.length).toBeGreaterThanOrEqual(1)

    // And one policy is the canonical name declared by migration 065.
    const named = polRes.rows.filter(
      (r) => r.polname === 'custom_field_definitions_org_isolation',
    )
    expect(named.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── Test 3 — SC2 (CF-11): reserved-key CHECK rejects forbidden keys ─────────
//
// Per-entity reserved-key enforcement. Every negative sub-test seeds its own
// throwaway org, attempts the failing INSERT, and cleans up via cascade-
// delete on the org in a finally block. The two positive controls prove
// (a) the CHECK is genuinely per-entity (not a global blacklist) and
// (b) a clean non-reserved key passes.

pgSuite('SC2 (CF-11): reserved-key CHECK', () => {
  // Helper: seed throwaway org, run the body, cleanup unconditionally.
  async function withThrowawayOrg(
    body: (orgId: string, suffix: string) => Promise<void>,
  ): Promise<void> {
    const suffix = Math.random().toString(36).slice(2, 10)
    const orgName = `cf-check-${suffix}`
    let orgId = ''
    try {
      const orgRes = await pg!.query<{ id: string }>(
        `INSERT INTO public.organizations (name, slug, widget_token)
         VALUES ($1, $1, $2)
         RETURNING id`,
        [orgName, `cf-wt-${suffix}`],
      )
      orgId = orgRes.rows[0].id
      await body(orgId, suffix)
    } finally {
      if (orgId) {
        await pg!.query(`DELETE FROM public.organizations WHERE id = $1`, [orgId])
      }
    }
  }

  // Helper: attempt INSERT and assert it fails on the reserved-key CHECK.
  async function expectReservedKeyRejection(
    orgId: string,
    entity: 'contact' | 'opportunity' | 'account',
    key: string,
  ): Promise<void> {
    let errMsg = ''
    try {
      await pg!.query(
        `INSERT INTO public.custom_field_definitions
           (org_id, entity, key, label, type)
         VALUES ($1, $2, $3, $4, 'text')`,
        [orgId, entity, key, `Reserved ${key}`],
      )
      throw new Error(
        `reserved-key insert (entity=${entity}, key=${key}) unexpectedly succeeded`,
      )
    } catch (err) {
      errMsg = String((err as Error).message ?? err)
    }

    // Postgres surfaces either the constraint name or the generic
    // "violates check constraint" phrasing. Accept either.
    const matched =
      errMsg.includes('custom_field_definitions_key_not_reserved') ||
      errMsg.includes('violates check constraint')
    expect(matched).toBe(true)
  }

  it('the custom_field_definitions_key_not_reserved CHECK constraint exists', async () => {
    const conRes = await pg!.query<{ conname: string; defn: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS defn
         FROM pg_constraint
        WHERE conname = 'custom_field_definitions_key_not_reserved'
          AND conrelid = 'public.custom_field_definitions'::regclass`,
    )
    expect(conRes.rowCount).toBe(1)

    // Sanity: the constraint definition references the universal reserved
    // set and uses a CASE branch on entity.
    const defn = conRes.rows[0].defn
    expect(defn).toContain('CASE')
    expect(defn).toContain('id')
    expect(defn).toContain('org_id')
  })

  it('inserting a definition with universal reserved key "id" is rejected (contact)', async () => {
    // Canonical shape under test: { entity: 'contact', key: 'id' }
    await withThrowawayOrg(async (orgId) => {
      await expectReservedKeyRejection(orgId, 'contact', 'id')
    })
  })

  it('inserting a definition with universal reserved key "org_id" is rejected (opportunity)', async () => {
    // Canonical shape under test: { entity: 'opportunity', key: 'org_id' }
    await withThrowawayOrg(async (orgId) => {
      await expectReservedKeyRejection(orgId, 'opportunity', 'org_id')
    })
  })

  it('inserting a contact definition with contact-native key "email" is rejected', async () => {
    // Canonical shape under test: { entity: 'contact', key: 'email' }
    await withThrowawayOrg(async (orgId) => {
      await expectReservedKeyRejection(orgId, 'contact', 'email')
    })
  })

  it('inserting an opportunity definition with opportunity-native key "pipeline_id" is rejected', async () => {
    // Canonical shape under test: { entity: 'opportunity', key: 'pipeline_id' }
    await withThrowawayOrg(async (orgId) => {
      await expectReservedKeyRejection(orgId, 'opportunity', 'pipeline_id')
    })
  })

  it('inserting an account definition with account-native key "domain" is rejected', async () => {
    // Canonical shape under test: { entity: 'account', key: 'domain' }
    await withThrowawayOrg(async (orgId) => {
      await expectReservedKeyRejection(orgId, 'account', 'domain')
    })
  })

  it('inserting a contact definition with key "domain" SUCCEEDS (per-entity isolation positive control)', async () => {
    // 'domain' is reserved on account but NOT on contact. This proves the
    // CHECK is genuinely per-entity, not a global blacklist.
    await withThrowawayOrg(async (orgId, suffix) => {
      const res = await pg!.query<{ id: string }>(
        `INSERT INTO public.custom_field_definitions
           (org_id, entity, key, label, type)
         VALUES ($1, 'contact', 'domain', $2, 'text')
         RETURNING id`,
        [orgId, `Domain ${suffix}`],
      )
      expect(res.rowCount).toBe(1)
      expect(res.rows[0].id).toBeTruthy()
    })
  })

  it('inserting a definition with a safe non-reserved key SUCCEEDS (positive control)', async () => {
    await withThrowawayOrg(async (orgId, suffix) => {
      const res = await pg!.query<{ id: string }>(
        `INSERT INTO public.custom_field_definitions
           (org_id, entity, key, label, type)
         VALUES ($1, 'contact', 'linkedin_url', $2, 'url')
         RETURNING id`,
        [orgId, `LinkedIn ${suffix}`],
      )
      expect(res.rowCount).toBe(1)
      expect(res.rows[0].id).toBeTruthy()
    })
  })
})

// ─── Test 4 — SC1 reality (CF-14): cross-org isolation via anon clients ──────

fullSuite('SC1 (CF-14) reality: custom_field_definitions cross-org isolation', () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const userAEmail = `cf-rls-a-${suffix}@example.test`
  const userBEmail = `cf-rls-b-${suffix}@example.test`
  const password = `Cf-Rls-${suffix}!`

  let admin: SupabaseClient<Database>
  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>

  let orgAId = ''
  let orgBId = ''
  let userAId = ''
  let userBId = ''
  let defAId = ''

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!, {
      auth: { persistSession: false },
    })

    const { data: orgA, error: orgAErr } = await admin
      .from('organizations')
      .insert({
        name: `CF RLS A ${suffix}`,
        slug: `cf-rls-a-${suffix}`,
        widget_token: `cf-rls-tok-a-${suffix}`,
      })
      .select('id')
      .single()
    if (orgAErr) throw orgAErr
    orgAId = orgA.id

    const { data: orgB, error: orgBErr } = await admin
      .from('organizations')
      .insert({
        name: `CF RLS B ${suffix}`,
        slug: `cf-rls-b-${suffix}`,
        widget_token: `cf-rls-tok-b-${suffix}`,
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

    // Service-role inserts a custom_field_definition into org A. We will probe
    // its visibility from the two anon clients below.
    const { data: def, error: defErr } = await admin
      .from('custom_field_definitions')
      .insert({
        org_id: orgAId,
        entity: 'contact',
        key: `crossorg_${suffix}`,
        label: `CrossOrg Test ${suffix}`,
        type: 'text',
      })
      .select('id')
      .single()
    if (defErr) throw defErr
    defAId = def.id

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

  it('definition inserted under org A is NOT visible to a user signed into org B', async () => {
    const { data, error } = await clientB
      .from('custom_field_definitions')
      .select('id, label')
      .eq('id', defAId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('definition inserted under org A IS visible to a user signed into org A', async () => {
    const { data, error } = await clientA
      .from('custom_field_definitions')
      .select('id, label')
      .eq('id', defAId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(defAId)
  })

  it('user signed into org B cannot insert a definition targeting org A (WITH CHECK)', async () => {
    const attackKey = `attack_${suffix}`
    const { data, error } = await clientB
      .from('custom_field_definitions')
      .insert({
        org_id: orgAId,
        entity: 'contact',
        key: attackKey,
        label: `Cross-tenant attack ${suffix}`,
        type: 'text',
      })
    expect(data).toBeNull()
    expect(error).toBeTruthy()

    // Service-role confirms no row was written under org A with the attack key.
    const { data: check } = await admin
      .from('custom_field_definitions')
      .select('id')
      .eq('org_id', orgAId)
      .eq('key', attackKey)
    expect(check ?? []).toHaveLength(0)
  })
})
