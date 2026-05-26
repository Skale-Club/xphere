#!/usr/bin/env node
// One-shot applier for migration 1059_contacts_unique_constraints.sql via pg client (pooler-safe).
// Wraps in transaction; on success records in supabase_migrations.schema_migrations.
//
// NOTE: Originally drafted as 1058; renamed to 1059 because version 1058 was
// already taken by a parallel mcp_oauth migration that landed first. The DDL
// is fully idempotent (IF NOT EXISTS) so re-applying after the rename is safe.

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

const MIGRATION_PATH = "supabase/migrations/1059_contacts_unique_constraints.sql";
const MIGRATION_VERSION = "1059";
const MIGRATION_NAME = "contacts_unique_constraints";

const sql = readFileSync(resolve(MIGRATION_PATH), "utf8");

const client = new Client({ connectionString });
await client.connect();

console.log(`Applying ${MIGRATION_PATH} (${sql.length} bytes) to xphere prod...`);

try {
  await client.query("BEGIN");

  await client.query(sql);
  console.log("  ✓ migration body applied");

  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     VALUES ($1, $2, ARRAY[$3])
     ON CONFLICT (version) DO NOTHING`,
    [MIGRATION_VERSION, MIGRATION_NAME, sql]
  );
  console.log("  ✓ recorded in schema_migrations");

  await client.query("COMMIT");
  console.log("  ✓ committed");
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
