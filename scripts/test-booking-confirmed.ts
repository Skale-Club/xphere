#!/usr/bin/env node
// One-off test: fix trigger_config + build meeting scope for a test booking.
// Uses only @supabase/supabase-js — no Next.js server-only imports.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/test-booking-confirmed.ts

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const ORG_ID = '24552ef3-de77-4fba-a2c3-148cd58d8750' // Skleanings
const TEST_PHONE = '+18572280830'
const TEST_NAME = 'Teste SKleanings'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('env vars missing'); process.exit(1) }

  const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

  // ── 1. Fix trigger_config for all event workflows missing event key ────────
  console.log('\n── Step 1: backfill trigger_config ──')
  const { data: wfs } = await sb
    .from('workflows')
    .select('id, slug, trigger_config, current_version_id')
    .eq('org_id', ORG_ID)
    .eq('trigger_type', 'event')

  for (const wf of wfs ?? []) {
    const cfg = wf.trigger_config as Record<string, unknown>
    if (cfg?.event) { console.log(`  ✓ ${wf.slug} already has event=${cfg.event}`); continue }
    if (!wf.current_version_id) { console.log(`  ⚠ ${wf.slug}: no version`); continue }

    const { data: ver } = await sb
      .from('workflow_versions').select('definition').eq('id', wf.current_version_id).single()

    const def = ver?.definition as Record<string, unknown> | null
    const nodes = def?.nodes as Array<Record<string, unknown>> | undefined
    const triggerNode = nodes?.find((n) => n.type === 'trigger')
    const eventType = (triggerNode?.data as Record<string, unknown>)?.event_type as string | undefined
    if (!eventType || eventType === 'manual') { console.log(`  ⚠ ${wf.slug}: no event_type`); continue }

    await sb.from('workflows').update({ trigger_config: { event: eventType } }).eq('id', wf.id)
    console.log(`  ✓ ${wf.slug} → event=${eventType}`)
  }

  // ── 2. Upsert contact ─────────────────────────────────────────────────────
  console.log('\n── Step 2: contact ──')
  let contactId: string
  const { data: existingContact } = await sb
    .from('contacts').select('id, name').eq('org_id', ORG_ID).eq('phone_e164', TEST_PHONE).maybeSingle()

  if (existingContact) {
    contactId = existingContact.id as string
    console.log(`  found: ${existingContact.name} (${contactId})`)
  } else {
    const { data: c, error } = await sb
      .from('contacts')
      .insert({ org_id: ORG_ID, name: TEST_NAME, phone: TEST_PHONE, source: 'api' })
      .select('id').single()
    if (error || !c) { console.error('  contact create failed:', error?.message); process.exit(1) }
    contactId = (c as { id: string }).id
    console.log(`  created: ${TEST_NAME} (${contactId})`)
  }

  // ── 3. Get or create event_type ───────────────────────────────────────────
  console.log('\n── Step 3: event type ──')
  const { data: et } = await sb
    .from('event_types').select('id, title').eq('org_id', ORG_ID).limit(1).maybeSingle()

  let eventTypeId: string
  if (et) {
    eventTypeId = (et as { id: string }).id
    console.log(`  using: ${(et as { title: string }).title} (${eventTypeId})`)
  } else {
    const { data: member } = await sb
      .from('org_members').select('user_id').eq('organization_id', ORG_ID).limit(1).maybeSingle()
    const { data: created, error } = await sb
      .from('event_types')
      .insert({ org_id: ORG_ID, user_id: (member as { user_id: string }).user_id,
        title: 'Limpeza Residencial', slug: 'limpeza-residencial', location_type: 'in_person' })
      .select('id').single()
    if (error || !created) { console.error('  event_type create failed:', error?.message); process.exit(1) }
    eventTypeId = (created as { id: string }).id
    console.log(`  created: Limpeza Residencial (${eventTypeId})`)
  }

  // ── 4. Create test booking ────────────────────────────────────────────────
  console.log('\n── Step 4: booking ──')
  const startAt = new Date()
  startAt.setDate(startAt.getDate() + 2)
  startAt.setHours(9, 0, 0, 0)
  const endAt = new Date(startAt.getTime() + 3 * 60 * 60 * 1000)

  const { data: booking, error: bErr } = await sb
    .from('bookings')
    .insert({
      org_id: ORG_ID, event_type_id: eventTypeId,
      booker_name: TEST_NAME, booker_email: 'teste@skleanings.test',
      booker_phone: TEST_PHONE,
      start_at: startAt.toISOString(), end_at: endAt.toISOString(),
      status: 'confirmed', linked_contact_id: contactId,
      notes: 'Booking de teste — script test-booking-confirmed.ts',
    })
    .select('id').single()

  if (bErr || !booking) { console.error('  booking create failed:', bErr?.message); process.exit(1) }
  const bookingId = (booking as { id: string }).id
  console.log(`  created: ${bookingId} @ ${startAt.toISOString()}`)

  // ── 5. Build meeting scope to pass as workflow payload ────────────────────
  console.log('\n── Step 5: build meeting scope ──')
  const meetingScope = {
    id: bookingId,
    org_id: ORG_ID,
    title: (et as { title?: string } | null)?.title ?? 'Limpeza Residencial',
    starts_at: startAt.toISOString(),
    ends_at: endAt.toISOString(),
    duration_minutes: 180,
    status: 'confirmed',
    notes: null,
    attendee_contact: {
      id: contactId,
      name: TEST_NAME,
      email: 'teste@skleanings.test',
      phone: TEST_PHONE,
    },
    event_type: {
      id: eventTypeId,
      name: (et as { title?: string } | null)?.title ?? 'Limpeza Residencial',
      slug: 'limpeza-residencial',
    },
    location: { kind: 'in_person', label: 'In person', address: null, coordinates: null, phone: null },
    link: '',
  }

  // ── 6. Find the SKleanings appointment-confirmation workflow ──────────────
  console.log('\n── Step 6: find workflow ──')
  const { data: matchedWfs } = await sb
    .from('workflows')
    .select('id, name, current_version_id')
    .eq('org_id', ORG_ID)
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event: 'meeting.confirmed' })

  console.log(`  matched: ${matchedWfs?.length ?? 0} workflow(s)`)
  for (const wf of matchedWfs ?? []) console.log(`    • ${wf.name} (${wf.id})`)

  if (!matchedWfs?.length) {
    console.error('\n✗ No workflows matched after backfill — something is wrong.')
    process.exit(1)
  }

  // Output payload for MCP trigger
  const triggerPayload = { meeting: meetingScope, event: 'meeting.confirmed' }
  console.log('\n── Payload to use with MCP workflows_trigger ──')
  console.log(JSON.stringify({ workflow_id: matchedWfs[0].id, org_id: ORG_ID, payload: triggerPayload }, null, 2))
}

main().catch((err) => { console.error(err); process.exit(99) })
