#!/usr/bin/env node
// Post-apply probes for migration 1059 partial UNIQUE indexes.
//   Probe A: both indexes exist in pg_indexes (expect 2 rows)
//   Probe B: duplicate live INSERT on same (org, phone) raises 23505
//   Probe C: INSERT colliding with archived_duplicate row succeeds (partial WHERE excludes archived)
// All synthetic rows are cleaned up via savepoint rollback + explicit DELETE belt-and-suspenders.

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

const probeMarker = `probe1058-${Date.now()}`;

try {
  // ---------- Probe A: indexes exist ----------
  const ixRes = await client.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'contacts'
        AND indexname IN ('contacts_org_phone_uniq','contacts_org_email_uniq')
      ORDER BY indexname`
  );
  console.log("Probe A — indexes present:", ixRes.rows.map((r) => r.indexname));
  if (ixRes.rows.length !== 2) {
    console.error("  ✗ expected 2 rows, got", ixRes.rows.length);
    process.exitCode = 1;
  } else {
    console.log("  ✓ both indexes present");
  }

  // Pick an org id for FK
  const orgRes = await client.query("SELECT id FROM public.organizations LIMIT 1");
  if (orgRes.rows.length === 0) throw new Error("no organizations row");
  const orgId = orgRes.rows[0].id;

  const probePhoneB = `+5511${Math.floor(900000000 + Math.random() * 99999999)}`;
  const probePhoneC = `+5511${Math.floor(800000000 + Math.random() * 99999999)}`;

  // ---------- Probe B: duplicate live insert raises 23505 ----------
  let probeBPass = false;
  let probeBSecondErrCode = null;
  await client.query("BEGIN");
  await client.query("SAVEPOINT s_b");
  try {
    await client.query(
      `INSERT INTO public.contacts (org_id, name, phone, source)
       VALUES ($1, $2, $3, 'manual')`,
      [orgId, `${probeMarker}-B1`, probePhoneB]
    );
    try {
      await client.query(
        `INSERT INTO public.contacts (org_id, name, phone, source)
         VALUES ($1, $2, $3, 'manual')`,
        [orgId, `${probeMarker}-B2`, probePhoneB]
      );
      console.error("  ✗ Probe B: second INSERT unexpectedly succeeded");
    } catch (e) {
      probeBSecondErrCode = e.code;
      if (e.code === "23505") {
        probeBPass = true;
      }
    }
  } finally {
    await client.query("ROLLBACK");
  }
  console.log(`Probe B — duplicate live INSERT raises 23505: code=${probeBSecondErrCode} ${probeBPass ? "✓" : "✗"}`);
  if (!probeBPass) process.exitCode = 1;

  // ---------- Probe C: archived row does NOT block ----------
  let probeCPass = false;
  let probeCSecondErr = null;
  await client.query("BEGIN");
  await client.query("SAVEPOINT s_c");
  try {
    await client.query(
      `INSERT INTO public.contacts (org_id, name, phone, source, identity_status)
       VALUES ($1, $2, $3, 'manual', 'archived_duplicate')`,
      [orgId, `${probeMarker}-C-archived`, probePhoneC]
    );
    try {
      await client.query(
        `INSERT INTO public.contacts (org_id, name, phone, source)
         VALUES ($1, $2, $3, 'manual')`,
        [orgId, `${probeMarker}-C-live`, probePhoneC]
      );
      probeCPass = true;
    } catch (e) {
      probeCSecondErr = { code: e.code, message: e.message };
    }
  } finally {
    await client.query("ROLLBACK");
  }
  console.log(`Probe C — archived row does NOT block live INSERT: ${probeCPass ? "✓ both inserts succeeded" : "✗ " + JSON.stringify(probeCSecondErr)}`);
  if (!probeCPass) process.exitCode = 1;

  // Belt-and-suspenders cleanup (in case rollback didn't catch something)
  await client.query(`DELETE FROM public.contacts WHERE name LIKE $1`, [`${probeMarker}-%`]);
} catch (err) {
  console.error("PROBE ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
