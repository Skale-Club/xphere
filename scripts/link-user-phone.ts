#!/usr/bin/env tsx
// Sets the sign-in phone of an existing user.
//   npx tsx scripts/link-user-phone.ts <email> <phone>
//
// Google-only accounts have no phone, and an unknown phone cannot sign in
// without an invite, so this is how an existing account gets its number.
// The number is an argument on purpose: it must never be committed.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { maskPhone, normalizePhone } from '../src/lib/auth/phone'

function loadEnvLocal() {
  const file = resolve(process.cwd(), '.env.local')
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  const [emailArg, phoneArg] = process.argv.slice(2)
  if (!emailArg || !phoneArg) fail('Usage: npx tsx scripts/link-user-phone.ts <email> <phone>')

  const phone = normalizePhone(phoneArg, '1')
  if (!phone) fail('That does not look like a phone number. Use 10 digits for the US, or start with + and the country code.')

  loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).')

  const sb = createClient(url, key, { auth: { persistSession: false } })
  const email = emailArg.trim().toLowerCase()

  const { data: user, error: userError } = await sb
    .from('users').select('id, email, phone').eq('email', email).maybeSingle()
  if (userError) fail(`Lookup failed: ${userError.message}`)
  if (!user) fail('No user with that email.')

  const { data: holder, error: holderError } = await sb
    .from('users').select('id').eq('phone', phone).maybeSingle()
  if (holderError) fail(`Lookup failed: ${holderError.message}`)
  if (holder && holder.id !== user.id) fail('Another user already holds that phone. Nothing was changed.')

  const { error } = await sb
    .from('users').update({ phone, updated_at: new Date().toISOString() }).eq('id', user.id)
  if (error) fail(`Update failed: ${error.message}`)

  console.log(`Linked ${maskPhone(phone)} to ${email}${user.phone ? ' (replaced the previous number)' : ''}.`)
}

main().catch((err) => fail(err instanceof Error ? err.message : 'Unexpected error'))
