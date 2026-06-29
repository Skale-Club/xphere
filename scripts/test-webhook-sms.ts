#!/usr/bin/env node
// End-to-end test: create a temp API key → call xkedule webhook → SMS fires.
// Cleans up the temp key at the end.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/test-webhook-sms.ts

import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'

const ORG_ID = '24552ef3-de77-4fba-a2c3-148cd58d8750'
const TEST_PHONE = '+18572280830'
const TEST_NAME = 'Ellen Laurino'
// Use local dev server so the booking.confirmed fix is active
const PROD_URL = 'http://localhost:4267'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('env vars missing'); process.exit(1) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createClient(url, key, { auth: { persistSession: false } }) as any

  // ── 1. Create temp API key ────────────────────────────────────────────────
  const plaintext = `xph_${randomBytes(32).toString('hex')}`
  const prefix = plaintext.slice(0, 8)
  const hash = hashToken(plaintext)

  // Need a user_id for created_by — use any org member
  const { data: member } = await sb
    .from('org_members')
    .select('user_id')
    .eq('organization_id', ORG_ID)
    .limit(1)
    .maybeSingle()

  const { data: apiKeyRow, error: keyErr } = await sb
    .from('api_keys')
    .insert({
      org_id: ORG_ID,
      name: 'test-webhook-sms (temp)',
      key_hash: hash,
      key_prefix: prefix,
      scopes: ['webhooks'],
      created_by: member?.user_id ?? null,
    })
    .select('id')
    .single()

  if (keyErr || !apiKeyRow) {
    console.error('API key insert failed:', keyErr?.message)
    process.exit(1)
  }
  const keyId = apiKeyRow.id
  console.log('✓ Temp API key created:', keyId)

  try {
    // ── 2. Build booking.confirmed payload ──────────────────────────────────
    const now = new Date()
    const bookingDate = '2026-07-02'
    const payload = {
      event: 'booking.confirmed',
      delivery_id: `test-${now.getTime()}`,
      occurred_at: now.toISOString(),
      booking: {
        id: 99999,
        status: 'confirmed',
        bookingDate,
        startTime: '09:00',
        endTime: '12:00',
        timeZone: 'America/New_York',
        services: [{ id: 1, name: 'Limpeza Residencial' }],
        customer: {
          name: TEST_NAME,
          phone: TEST_PHONE,
          email: 'teste@skleanings.test',
          address: null,
        },
      },
    }

    // ── 3. POST to production webhook ────────────────────────────────────────
    console.log(`\nPOSTing booking.confirmed to ${PROD_URL}/api/xkedule/webhook ...`)
    const resp = await fetch(`${PROD_URL}/api/xkedule/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${plaintext}`,
      },
      body: JSON.stringify(payload),
    })

    const body = await resp.json()
    console.log('Response:', resp.status, JSON.stringify(body))

    if (body?.skipped) {
      console.warn('\n⚠ Webhook returned skipped:', body.skipped)
    } else if (body?.ok) {
      console.log('\n✓ Webhook accepted — workflow should have fired → SMS to', TEST_PHONE)
    }
  } finally {
    // ── 4. Revoke temp key ───────────────────────────────────────────────────
    await sb
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId)
    console.log('\n✓ Temp API key revoked')
  }
}

main().catch((e) => { console.error(e); process.exit(99) })
