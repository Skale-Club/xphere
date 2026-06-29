#!/usr/bin/env node
// Fetch the first active API key hash for SKleanings org to use for webhook test.
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
    .from('api_keys')
    .select('id, name, key_preview, created_at')
    .eq('org_id', ORG_ID)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) { console.error(error.message); process.exit(1) }
  console.log('API keys for SKleanings:')
  console.log(JSON.stringify(data, null, 2))
  console.log('\nNote: plaintext keys are not stored. Need to create a new one or use an existing key.')
}

main().catch((e) => { console.error(e); process.exit(1) })
