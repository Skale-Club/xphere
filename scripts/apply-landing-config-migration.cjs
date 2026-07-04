#!/usr/bin/env node
// One-off migration runner that bypasses the supabase CLI migration-history
// conflict for migration 105. Reads supabase/migrations/1050_landing_config.sql
// and applies it against the pooled connection in DATABASE_URL.
const fs = require('fs')
const path = require('path')

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

async function main() {
  loadEnv()
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL missing in .env.local')

  const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '1050_landing_config.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')

  const { Client } = require('pg')
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    const r = await client.query('select id, cta_image_url, scroll_images, updated_at from public.landing_config')
    console.log('OK rows:', r.rows)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
