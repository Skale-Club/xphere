#!/usr/bin/env node
// One-shot applier for migration 1062_contact_verifications.sql via pg client (pooler-safe).
// Wraps in transaction; runs 4 SQL probes (table, index, UNIQUE 23505, CASCADE)
// before COMMIT. On success records in supabase_migrations.schema_migrations.

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

const MIGRATION_PATH = "supabase/migrations/1062_contact_verifications.sql";
const MIGRATION_VERSION = "1062";
const MIGRATION_NAME = "contact_verifications";

const sql = readFileSync(resolve(MIGRATION_PATH), "utf8");

const client = new Client({ connectionString });
await client.connect();

console.log(`Applying ${MIGRATION_PATH} (${sql.length} bytes) to xphere prod...`);

async function runProbe(label, fn) {
  try {
    await fn();
    console.log(`  ✓ probe: ${label}`);
  } catch (e) {
    console.error(`  ✗ probe FAILED: ${label}`);
    throw e;
  }
}

try {
  await client.query("BEGIN");

  await client.query(sql);
  console.log("  ✓ migration body applied");

  // -------- PROBE 1: table exists --------
  await runProbe("table contact_verifications exists", async () => {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='contact_verifications'`
    );
    if (rows.length !== 1) throw new Error("table missing");
  });

  // -------- PROBE 2: index exists --------
  await runProbe("index idx_contact_verifications_contact_id exists", async () => {
    const { rows } = await client.query(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname='public'
          AND indexname='idx_contact_verifications_contact_id'`
    );
    if (rows.length !== 1) throw new Error("index missing");
  });

  // -------- PROBE 3: UNIQUE collision returns 23505 --------
  // Use a SAVEPOINT so the duplicate-INSERT error doesn't poison the outer txn.
  // Picks any existing (org, contact) pair to make the inserts valid; rolls back
  // savepoint after to discard probe state.
  await runProbe("UNIQUE collision returns 23505", async () => {
    const { rows: pair } = await client.query(
      `SELECT id AS contact_id, org_id FROM public.contacts LIMIT 1`
    );
    if (!pair.length) {
      // No contacts in DB -- skip but log; not a fail (RLS will validate on app use).
      console.log("    (skipped: no contacts available for collision probe)");
      return;
    }
    const { contact_id, org_id } = pair[0];
    const probeValue = "+5500000000000__probe_1062__";

    await client.query("SAVEPOINT probe_unique");
    try {
      await client.query(
        `INSERT INTO public.contact_verifications
           (org_id, contact_id, identifier_type, identifier_value, method)
         VALUES ($1, $2, 'phone', $3, 'manual')`,
        [org_id, contact_id, probeValue]
      );
      let collided = false;
      try {
        await client.query(
          `INSERT INTO public.contact_verifications
             (org_id, contact_id, identifier_type, identifier_value, method)
           VALUES ($1, $2, 'phone', $3, 'manual')`,
          [org_id, contact_id, probeValue]
        );
      } catch (e) {
        if (e.code !== "23505") throw new Error(`expected 23505, got ${e.code}`);
        collided = true;
      }
      if (!collided) throw new Error("duplicate INSERT did not raise 23505");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT probe_unique");
      await client.query("RELEASE SAVEPOINT probe_unique");
    }
  });

  // -------- PROBE 4: CASCADE on contact delete removes verification rows --------
  // Insert temp contact + verification, DELETE contact, assert verification gone.
  // Wrapped in SAVEPOINT so probe state never commits.
  await runProbe("CASCADE delete on contacts removes verifications", async () => {
    const { rows: orgRow } = await client.query(
      `SELECT id FROM public.organizations LIMIT 1`
    );
    if (!orgRow.length) {
      console.log("    (skipped: no organizations available for cascade probe)");
      return;
    }
    const orgId = orgRow[0].id;

    await client.query("SAVEPOINT probe_cascade");
    try {
      const { rows: tmpContact } = await client.query(
        `INSERT INTO public.contacts (org_id, name, identity_status)
         VALUES ($1, '__probe_1062_cascade__', 'identified')
         RETURNING id`,
        [orgId]
      );
      const contactId = tmpContact[0].id;

      await client.query(
        `INSERT INTO public.contact_verifications
           (org_id, contact_id, identifier_type, identifier_value, method)
         VALUES ($1, $2, 'email', '__probe_1062_cascade__@example.invalid', 'manual')`,
        [orgId, contactId]
      );

      const { rows: before } = await client.query(
        `SELECT 1 FROM public.contact_verifications WHERE contact_id=$1`,
        [contactId]
      );
      if (before.length !== 1) throw new Error("verification row not inserted");

      await client.query(`DELETE FROM public.contacts WHERE id=$1`, [contactId]);

      const { rows: after } = await client.query(
        `SELECT 1 FROM public.contact_verifications WHERE contact_id=$1`,
        [contactId]
      );
      if (after.length !== 0) throw new Error("verification row survived contact delete");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT probe_cascade");
      await client.query("RELEASE SAVEPOINT probe_cascade");
    }
  });

  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     VALUES ($1, $2, ARRAY[$3])
     ON CONFLICT (version) DO NOTHING`,
    [MIGRATION_VERSION, MIGRATION_NAME, sql]
  );
  console.log("  ✓ recorded in schema_migrations");

  await client.query("COMMIT");
  console.log("  ✓ committed");
  console.log("migration 1062 applied");
} catch (err) {
  console.error("  ✗ ROLLING BACK");
  console.error("  error:", err.message);
  if (err.position) console.error("  position:", err.position);
  if (err.detail) console.error("  detail:", err.detail);
  if (err.hint) console.error("  hint:", err.hint);
  try { await client.query("ROLLBACK"); } catch {}
  process.exitCode = 1;
} finally {
  await client.end();
}
