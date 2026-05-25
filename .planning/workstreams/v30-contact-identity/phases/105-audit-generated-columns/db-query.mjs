#!/usr/bin/env node
// Helper to run SQL against the xphere prod DB using DATABASE_URL from .env.local.
// Usage: node db-query.mjs <query-name>
//        node db-query.mjs --file <path-to-sql>
//        echo "SELECT ..." | node db-query.mjs --stdin

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const dbUrlMatch = envText.match(/^DATABASE_URL=(.+)$/m);
if (!dbUrlMatch) {
  console.error("DATABASE_URL not found in .env.local");
  process.exit(1);
}
const connectionString = dbUrlMatch[1].trim().replace(/^["']|["']$/g, "");

async function readSql() {
  const args = process.argv.slice(2);
  if (args[0] === "--file") {
    return readFileSync(resolve(args[1]), "utf8");
  }
  if (args[0] === "--stdin") {
    return await new Promise((r) => {
      let buf = "";
      process.stdin.on("data", (d) => (buf += d));
      process.stdin.on("end", () => r(buf));
    });
  }
  if (args[0] === "--query") {
    return args.slice(1).join(" ");
  }
  console.error("usage: db-query.mjs --file <path> | --stdin | --query <sql>");
  process.exit(1);
}

const sql = await readSql();
const client = new Client({ connectionString });
await client.connect();
try {
  const result = await client.query(sql);
  if (Array.isArray(result)) {
    for (const r of result) {
      console.log(JSON.stringify({ command: r.command, rowCount: r.rowCount, rows: r.rows }, null, 2));
    }
  } else {
    console.log(JSON.stringify({ command: result.command, rowCount: result.rowCount, rows: result.rows }, null, 2));
  }
} catch (err) {
  console.error("SQL ERROR:", err.message);
  if (err.position) console.error("position:", err.position);
  process.exitCode = 1;
} finally {
  await client.end();
}
