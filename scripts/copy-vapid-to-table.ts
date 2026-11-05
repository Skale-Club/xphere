// Copies the Web Push VAPID config from Supabase Vault into public.push_vapid_config
// (migration 1337), encrypting the private key with src/lib/crypto.ts.
//
// Reads the Vault through get_push_vapid_config() with the service role. Prints
// only "copied" or an error, never a value. Dry run by default: it reads and
// encrypts but writes nothing. Pass --apply to write the row.
//
//   npx tsx --env-file=.env.local scripts/copy-vapid-to-table.ts
//   npx tsx --env-file=.env.local scripts/copy-vapid-to-table.ts --apply
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ENCRYPTION_SECRET.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { encrypt, decrypt } from '@/lib/crypto'

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply')
  const db = createServiceRoleClient()

  const { data, error } = await db.rpc('get_push_vapid_config')
  if (error) {
    console.error(`error: could not read Vault: ${error.message}`)
    return 1
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { public_key?: string; private_key?: string; contact?: string }
    | null
  if (!row?.public_key || !row.private_key || !row.contact) {
    console.error('error: Vault is missing one of vapid_public_key, vapid_private_key, vapid_contact')
    return 1
  }

  let encrypted: string
  try {
    encrypted = await encrypt(row.private_key)
    // Prove the round trip before anything is written.
    if ((await decrypt(encrypted)) !== row.private_key) throw new Error('round trip mismatch')
  } catch (err) {
    console.error(`error: could not encrypt the private key: ${err instanceof Error ? err.message : 'unknown'}`)
    return 1
  }

  if (!apply) {
    console.log('dry run: Vault read and encryption check passed; nothing written (use --apply)')
    return 0
  }

  const { error: writeError } = await db.from('push_vapid_config').upsert({
    id: true,
    public_key: row.public_key,
    private_key_encrypted: encrypted,
    contact: row.contact,
    updated_at: new Date().toISOString(),
  })
  if (writeError) {
    console.error(`error: could not write push_vapid_config: ${writeError.message}`)
    return 1
  }

  console.log('copied')
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${err instanceof Error ? err.message : 'unknown'}`)
    process.exit(1)
  },
)
