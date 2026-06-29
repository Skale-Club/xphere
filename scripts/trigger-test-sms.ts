#!/usr/bin/env node
// One-off: enqueue a workflow_run directly via service role to test the
// SKleanings appointment-confirmation workflow (bypasses MCP which still
// has status='pending' bug on production).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/trigger-test-sms.ts

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const ORG_ID = '24552ef3-de77-4fba-a2c3-148cd58d8750'
const WORKFLOW_ID = '0f80c7fe-a2e7-43b5-9c0f-0c907ac93062'
const TEST_PHONE = '+18572280830'
const TEST_NAME = 'Ellen Laurino'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('env vars missing'); process.exit(1) }

  const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

  // Build the meeting payload
  const startsAt = new Date('2026-07-01T09:00:00.000Z')
  const endsAt = new Date('2026-07-01T12:00:00.000Z')

  const payload = {
    event: 'meeting.confirmed',
    meeting: {
      id: `test-${Date.now()}`,
      org_id: ORG_ID,
      title: 'Limpeza Residencial',
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_minutes: 180,
      status: 'confirmed',
      notes: null,
      attendee_contact: {
        id: 'test-contact',
        name: TEST_NAME,
        email: 'teste@skleanings.test',
        phone: TEST_PHONE,
      },
      event_type: {
        id: 'test-event-type',
        name: 'Limpeza Residencial',
        slug: 'limpeza-residencial',
      },
      location: { kind: 'in_person', label: 'In person', address: null, coordinates: null, phone: null },
      link: '',
    },
  }

  console.log('Enqueueing workflow run...')
  console.log('  workflow_id:', WORKFLOW_ID)
  console.log('  phone:', TEST_PHONE)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: run, error } = await (sb as any)
    .from('workflow_runs')
    .insert({
      org_id: ORG_ID,
      workflow_id: WORKFLOW_ID,
      trigger_type: 'manual',
      trigger_payload: payload,
      status: 'queued',
    })
    .select('id, status, created_at')
    .single()

  if (error || !run) {
    console.error('Insert failed:', error?.message)
    process.exit(1)
  }

  console.log('\n✓ workflow_run enqueued')
  console.log('  run_id:', (run as { id: string }).id)
  console.log('  status:', (run as { status: string }).status)
  console.log('  created_at:', (run as { created_at: string }).created_at)
  console.log('\nWorker will pick this up and execute send_sms → Twilio → SMS to', TEST_PHONE)
}

main().catch((err) => { console.error(err); process.exit(99) })
