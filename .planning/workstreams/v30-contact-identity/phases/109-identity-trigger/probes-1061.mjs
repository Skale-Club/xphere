#!/usr/bin/env node
// Phase 109 trigger probes (D-07 test cases run via raw pg client).
// 6 probes map to the deferrable-pass / deferrable-fail / orphan-block /
// orphan-allow / promote / archived-exempt scenarios.
//
// Cleanup deletes channel identities BEFORE contacts (otherwise the orphan
// trigger fires during teardown).

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

const cleanupContactIds = [];
const tag = `p109-${Date.now()}`;
let failures = 0;

function ok(n, msg) { console.log(`[PROBE ${n}] OK${msg ? " — " + msg : ""}`); }
function fail(n, reason) { console.error(`[PROBE ${n}] FAIL: ${reason}`); failures++; }

async function getOrgId() {
  const { rows } = await client.query("SELECT id FROM public.organizations LIMIT 1");
  if (!rows.length) throw new Error("no organizations found in DB");
  return rows[0].id;
}

const orgId = await getOrgId();
console.log(`Using org_id=${orgId} (tag=${tag})`);

// --------------------------------------------------------------------------
// PROBE 1: deferred-pass with channel_only-skip
// BEGIN; INSERT contact(channel_only); INSERT cci; COMMIT; -> succeeds
// --------------------------------------------------------------------------
try {
  await client.query("BEGIN");
  const { rows: c } = await client.query(
    `INSERT INTO public.contacts (org_id, name, identity_status)
     VALUES ($1, $2, 'channel_only') RETURNING id`,
    [orgId, `${tag}-p1`]
  );
  cleanupContactIds.push(c[0].id);
  await client.query(
    `INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
     VALUES ($1, $2, 'telegram', $3)`,
    [orgId, c[0].id, `${tag}-ext-p1`]
  );
  await client.query("COMMIT");
  ok(1, "deferred-pass + channel_only-skip");
} catch (err) {
  try { await client.query("ROLLBACK"); } catch {}
  fail(1, err.message);
}

// --------------------------------------------------------------------------
// PROBE 2: deferred-fail
// BEGIN; INSERT contact(identified, no phone/email/identity); COMMIT; -> RAISE
// --------------------------------------------------------------------------
try {
  await client.query("BEGIN");
  let didRaise = false;
  try {
    const { rows: c } = await client.query(
      `INSERT INTO public.contacts (org_id, name, identity_status)
       VALUES ($1, $2, 'identified') RETURNING id`,
      [orgId, `${tag}-p2`]
    );
    cleanupContactIds.push(c[0].id);
    await client.query("COMMIT");
  } catch (err) {
    didRaise = true;
    try { await client.query("ROLLBACK"); } catch {}
    if (!/identity invariant/i.test(err.message)) {
      fail(2, `raised but wrong message: ${err.message}`);
    } else {
      ok(2, "deferred-fail (identity invariant raised at COMMIT)");
    }
  }
  if (!didRaise) fail(2, "expected RAISE but commit succeeded");
} catch (err) {
  fail(2, `unexpected: ${err.message}`);
}

// --------------------------------------------------------------------------
// PROBE 3: orphan-block
// Insert channel_only contact + 1 identity. DELETE identity -> RAISE.
// --------------------------------------------------------------------------
try {
  const { rows: c } = await client.query(
    `INSERT INTO public.contacts (org_id, name, identity_status)
     VALUES ($1, $2, 'channel_only') RETURNING id`,
    [orgId, `${tag}-p3`]
  );
  cleanupContactIds.push(c[0].id);
  // Must wrap insert+commit because channel_only contact alone passes (skip),
  // but creating cci satisfies the invariant if it were checked.
  const { rows: ident } = await client.query(
    `INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
     VALUES ($1, $2, 'whatsapp', $3) RETURNING id`,
    [orgId, c[0].id, `${tag}-ext-p3`]
  );
  let didRaise = false;
  try {
    await client.query(`DELETE FROM public.contact_channel_identities WHERE id = $1`, [ident[0].id]);
  } catch (err) {
    didRaise = true;
    if (!/last channel identity/i.test(err.message)) {
      fail(3, `raised but wrong message: ${err.message}`);
    } else {
      ok(3, "orphan-block (last identity delete blocked)");
    }
  }
  if (!didRaise) fail(3, "expected RAISE but DELETE succeeded");
} catch (err) {
  fail(3, `setup error: ${err.message}`);
}

// --------------------------------------------------------------------------
// PROBE 4: orphan-allow
// Insert identified contact w/ phone + 1 identity. DELETE identity -> succeeds.
// --------------------------------------------------------------------------
try {
  const phone = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;
  const { rows: c } = await client.query(
    `INSERT INTO public.contacts (org_id, name, phone, identity_status)
     VALUES ($1, $2, $3, 'identified') RETURNING id`,
    [orgId, `${tag}-p4`, phone]
  );
  cleanupContactIds.push(c[0].id);
  const { rows: ident } = await client.query(
    `INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
     VALUES ($1, $2, 'whatsapp', $3) RETURNING id`,
    [orgId, c[0].id, `${tag}-ext-p4`]
  );
  await client.query(`DELETE FROM public.contact_channel_identities WHERE id = $1`, [ident[0].id]);
  ok(4, "orphan-allow (phone-backed contact)");
} catch (err) {
  fail(4, err.message);
}

// --------------------------------------------------------------------------
// PROBE 5: promote
// Insert channel_only contact + identity. UPDATE phone. identity_status -> 'identified'
// --------------------------------------------------------------------------
try {
  const { rows: c } = await client.query(
    `INSERT INTO public.contacts (org_id, name, identity_status)
     VALUES ($1, $2, 'channel_only') RETURNING id`,
    [orgId, `${tag}-p5`]
  );
  cleanupContactIds.push(c[0].id);
  await client.query(
    `INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
     VALUES ($1, $2, 'telegram', $3)`,
    [orgId, c[0].id, `${tag}-ext-p5`]
  );
  const promotionPhone = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;
  await client.query(`UPDATE public.contacts SET phone = $1 WHERE id = $2`, [promotionPhone, c[0].id]);
  const { rows: after } = await client.query(
    `SELECT identity_status FROM public.contacts WHERE id = $1`,
    [c[0].id]
  );
  if (after[0].identity_status !== "identified") {
    fail(5, `expected identified, got ${after[0].identity_status}`);
  } else {
    ok(5, "promote channel_only -> identified on phone add");
  }
} catch (err) {
  fail(5, err.message);
}

// --------------------------------------------------------------------------
// PROBE 6: archived-exempt
// Insert identified contact w/ phone. UPDATE status -> archived_duplicate.
// UPDATE phone = NULL -> succeeds (no RAISE because archived).
// --------------------------------------------------------------------------
try {
  const phone = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;
  const { rows: c } = await client.query(
    `INSERT INTO public.contacts (org_id, name, phone, identity_status)
     VALUES ($1, $2, $3, 'identified') RETURNING id`,
    [orgId, `${tag}-p6`, phone]
  );
  cleanupContactIds.push(c[0].id);
  await client.query(
    `UPDATE public.contacts SET identity_status = 'archived_duplicate' WHERE id = $1`,
    [c[0].id]
  );
  await client.query(`UPDATE public.contacts SET phone = NULL WHERE id = $1`, [c[0].id]);
  ok(6, "archived-exempt (null phone on archived row allowed)");
} catch (err) {
  fail(6, err.message);
}

// --------------------------------------------------------------------------
// Cleanup
// --------------------------------------------------------------------------
console.log(`Cleaning up ${cleanupContactIds.length} test contacts...`);
try {
  if (cleanupContactIds.length > 0) {
    // Flip channel_only test contacts to archived_duplicate so the orphan
    // trigger exempts them during cleanup. Then delete identities, then
    // delete contacts.
    await client.query(
      `UPDATE public.contacts SET identity_status = 'archived_duplicate'
       WHERE id = ANY($1) AND identity_status = 'channel_only'`,
      [cleanupContactIds]
    );
    await client.query(
      `DELETE FROM public.contact_channel_identities WHERE contact_id = ANY($1)`,
      [cleanupContactIds]
    );
    await client.query(`DELETE FROM public.contacts WHERE id = ANY($1)`, [cleanupContactIds]);
  }
  console.log("  ✓ cleanup done");
} catch (err) {
  console.error("  ✗ cleanup error:", err.message);
  failures++;
}

await client.end();
if (failures > 0) {
  console.error(`\n${failures} probe(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll 6 probes passed.");
}
