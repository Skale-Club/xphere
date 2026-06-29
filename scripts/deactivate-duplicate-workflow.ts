#!/usr/bin/env node
// Deactivate the platform-default "Booking confirmation SMS" for SKleanings
// since the custom appointment-confirmation workflow already sends a personalised SMS.
import { createClient } from '@supabase/supabase-js'

const ORG_ID = '24552ef3-de77-4fba-a2c3-148cd58d8750'
// fa445331 = "Booking confirmation SMS" (platform-default, overlaps with custom)
const WORKFLOW_ID = 'fa445331-77c0-427e-8522-eaa2b6542aec'

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  ) as any

  const { error } = await sb
    .from('workflows')
    .update({ is_active: false })
    .eq('id', WORKFLOW_ID)
    .eq('org_id', ORG_ID)

  if (error) { console.error('Update failed:', error.message); process.exit(1) }
  console.log('✓ "Booking confirmation SMS" desativado para SKleanings')
  console.log('  Apenas o workflow customizado SKleanings — Confirmação de Agendamento irá disparar.')
}

main().catch((e) => { console.error(e); process.exit(1) })
