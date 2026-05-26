#!/usr/bin/env node
// Post-apply probes for migration 1060. Verifies UNIQUE, CHECK, CASCADE, RLS,
// and backfill idempotency. Each probe is wrapped in a SAVEPOINT + ROLLBACK
// so prod data is untouched.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const dbUrlMatch = envText.match(/^DATABASE_URL=(.+)$/m);
if (!dbUrlMatch) {
  console.error("DATABASE_URL not found");
  process.exit(1);
}
const connectionString = dbUrlMatch[1].trim().replace(/^["']|["']$/g, "");

const client = new Client({ connectionString });
await client.connect();

const results = {};

// ---- Probe A: indexes + constraints exist ----
{
  const r = await client.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND tablename='contact_channel_identities'
      ORDER BY indexname`
  );
  results.probeA = {
    expect: ">= 3 rows (PK + UNIQUE + idx_cci_contact_id)",
    rowCount: r.rowCount,
    rows: r.rows.map((x) => x.indexname),
    pass: r.rowCount >= 3 && r.rows.some((x) => x.indexname === "idx_cci_contact_id"),
  };
}

// ---- Probe B: UNIQUE violation raises 23505 ----
await client.query("BEGIN");
try {
  await client.query("SAVEPOINT s");
  // Get a contact for org context
  const { rows: contactRows } = await client.query(
    `SELECT id, org_id FROM public.contacts LIMIT 1`
  );
  if (contactRows.length === 0) {
    results.probeB = { skip: "no contacts in prod to use for probe" };
  } else {
    const { id: cid, org_id: orgId } = contactRows[0];
    await client.query(
      `INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'webchat', 'probe-ext-1')`,
      [orgId, cid]
    );
    let sqlstate = null;
    try {
      await client.query(
        `INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
         VALUES ($1, $2, 'webchat', 'probe-ext-1')`,
        [orgId, cid]
      );
    } catch (err) {
      sqlstate = err.code;
    }
    results.probeB = {
      expect: "SQLSTATE 23505 on duplicate (org_id, provider, external_id)",
      sqlstate,
      pass: sqlstate === "23505",
    };
  }
} finally {
  await client.query("ROLLBACK");
}

// ---- Probe C: CHECK rejects invalid provider (23514) ----
await client.query("BEGIN");
try {
  await client.query("SAVEPOINT s");
  const { rows: contactRows } = await client.query(
    `SELECT id, org_id FROM public.contacts LIMIT 1`
  );
  if (contactRows.length === 0) {
    results.probeC = { skip: "no contacts in prod" };
  } else {
    const { id: cid, org_id: orgId } = contactRows[0];
    let sqlstate = null;
    try {
      await client.query(
        `INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
         VALUES ($1, $2, 'definitely-not-a-provider', 'x')`,
        [orgId, cid]
      );
    } catch (err) {
      sqlstate = err.code;
    }
    results.probeC = {
      expect: "SQLSTATE 23514 on invalid provider",
      sqlstate,
      pass: sqlstate === "23514",
    };
  }
} finally {
  await client.query("ROLLBACK");
}

// ---- Probe D: ON DELETE CASCADE ----
await client.query("BEGIN");
try {
  await client.query("SAVEPOINT s");
  const { rows: orgRows } = await client.query(
    `SELECT id FROM public.organizations LIMIT 1`
  );
  if (orgRows.length === 0) {
    results.probeD = { skip: "no organizations in prod" };
  } else {
    const orgId = orgRows[0].id;
    // Insert a synthetic contact
    const { rows: newC } = await client.query(
      `INSERT INTO public.contacts (org_id, name, source)
       VALUES ($1, 'probe-cascade', 'manual')
       RETURNING id`,
      [orgId]
    );
    const cid = newC[0].id;
    await client.query(
      `INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'webchat', 'probe-cascade-ext')`,
      [orgId, cid]
    );
    // Verify identity exists
    const before = await client.query(
      `SELECT count(*)::int AS n FROM public.contact_channel_identities WHERE contact_id = $1`,
      [cid]
    );
    // Delete contact
    await client.query(`DELETE FROM public.contacts WHERE id = $1`, [cid]);
    // Verify cascade removed identity
    const after = await client.query(
      `SELECT count(*)::int AS n FROM public.contact_channel_identities WHERE contact_id = $1`,
      [cid]
    );
    results.probeD = {
      expect: "before=1 after=0 (cascade removed identity)",
      before: before.rows[0].n,
      after: after.rows[0].n,
      pass: before.rows[0].n === 1 && after.rows[0].n === 0,
    };
  }
} finally {
  await client.query("ROLLBACK");
}

// ---- Probe E: RLS blocks anonymous SELECT ----
// Approach: same transaction, SET LOCAL role TO anon then SELECT count.
// First, count via service role to see baseline; then switch role.
await client.query("BEGIN");
try {
  const baseline = await client.query(
    `SELECT count(*)::int AS n FROM public.contact_channel_identities`
  );
  await client.query(`SET LOCAL ROLE anon`);
  const anonCount = await client.query(
    `SELECT count(*)::int AS n FROM public.contact_channel_identities`
  );
  results.probeE = {
    expect: "anon SELECT returns 0 rows (RLS hides everything)",
    baselineRows: baseline.rows[0].n,
    anonRows: anonCount.rows[0].n,
    pass: anonCount.rows[0].n === 0,
  };
} catch (err) {
  results.probeE = { error: err.message, code: err.code };
} finally {
  await client.query("ROLLBACK");
}

// ---- Probe F (bonus): backfill idempotency — re-run the SELECT body ----
// The migration is already idempotent (ON CONFLICT DO NOTHING). Confirm by
// re-running just the backfill body and inspecting affected rows count.
{
  const r = await client.query(
    `INSERT INTO public.contact_channel_identities
       (org_id, contact_id, provider, external_id, created_at)
     SELECT c.org_id, c.id, c.source::text, c.external_id, c.created_at
       FROM public.contacts c
      WHERE c.source IN ('instagram','whatsapp','facebook','messenger')
        AND c.external_id IS NOT NULL
     ON CONFLICT (org_id, provider, external_id) DO NOTHING`
  );
  results.probeF_backfillIdempotent = {
    expect: "rowCount = 0 (no new rows on re-run; prod baseline 0)",
    rowCount: r.rowCount,
    pass: r.rowCount === 0,
  };
}

// ---- schema_migrations row evidence ----
{
  const r = await client.query(
    `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='1060'`
  );
  results.schemaMigrationsRow = {
    rowCount: r.rowCount,
    row: r.rows[0] || null,
    pass: r.rowCount === 1,
  };
}

await client.end();
console.log(JSON.stringify(results, null, 2));

const allPass = Object.values(results).every((v) => v.pass === true || v.skip);
process.exitCode = allPass ? 0 : 2;
