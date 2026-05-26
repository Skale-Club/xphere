#!/usr/bin/env node
// Run a SQL file against prod, capturing NOTICEs (which pg client suppresses by default).
// Usage: node run-probe.mjs <path-to-sql>

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

const filePath = process.argv[2];
if (!filePath) {
  console.error("usage: run-probe.mjs <path-to-sql>");
  process.exit(1);
}
const sql = readFileSync(resolve(filePath), "utf8");

const client = new Client({ connectionString });
const notices = [];
client.on("notice", (n) => {
  notices.push(`[${n.severity || "NOTICE"}] ${n.message}`);
  console.log(`NOTICE: ${n.message}`);
});

await client.connect();
try {
  const result = await client.query(sql);
  console.log(`OK command=${result.command || "DO"} notices_captured=${notices.length}`);
} catch (err) {
  console.error("SQL ERROR:", err.message);
  if (err.detail) console.error("  detail:", err.detail);
  if (err.hint) console.error("  hint:", err.hint);
  process.exitCode = 1;
} finally {
  await client.end();
}
