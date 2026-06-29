#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'

const ORG_ID = '24552ef3-de77-4fba-a2c3-148cd58d8750'

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from('workflow_runs')
    .select('id, status, error, started_at, ended_at, trigger_type, created_at')
    .eq('org_id', ORG_ID)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) { console.error('Query error:', error.message); process.exit(1) }
  console.log(JSON.stringify(data, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
