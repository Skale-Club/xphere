// src/lib/push/vapid-config.ts
// Server-side VAPID config for the Node push sender.
//
// Read order:
//   1. table public.push_vapid_config (service role only; the private key is
//      encrypted with lib/crypto.ts), written by scripts/copy-vapid-to-table.ts
//   2. the RPC public.get_push_vapid_config() (Supabase Vault, migration 1217)
//
// Vault does not exist in the self-hosted database, so the table is the
// destination; the RPC stays as the fallback until the move. A table that is
// missing, empty or unreadable falls through to the RPC instead of failing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt as defaultDecrypt } from '@/lib/crypto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export const VAPID_TABLE = 'push_vapid_config'

export interface VapidConfig {
  public_key: string
  private_key: string
  contact: string
}

export type VapidSource = 'table' | 'rpc'

let cached: { config: VapidConfig; source: VapidSource } | null = null

export function resetVapidConfigCacheForTests(): void {
  cached = null
}

function complete(v: Partial<VapidConfig> | null | undefined): v is VapidConfig {
  return !!v && !!v.public_key && !!v.private_key && !!v.contact
}

async function fromTable(db: Db, decrypt: (s: string) => Promise<string>): Promise<VapidConfig | null> {
  const { data, error } = await db
    .from(VAPID_TABLE)
    .select('public_key, private_key_encrypted, contact')
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { public_key?: string; private_key_encrypted?: string; contact?: string }
  if (!row.public_key || !row.private_key_encrypted || !row.contact) return null
  try {
    return {
      public_key: row.public_key,
      private_key: await decrypt(row.private_key_encrypted),
      contact: row.contact,
    }
  } catch (err) {
    console.error('[push/vapid-config] could not decrypt the table row, falling back to the RPC:', err instanceof Error ? err.name : 'error')
    return null
  }
}

async function fromRpc(db: Db): Promise<{ config: VapidConfig | null; error: string | null }> {
  const { data, error } = await db.rpc('get_push_vapid_config')
  const row = Array.isArray(data) ? data[0] : data
  if (error || !complete(row)) return { config: null, error: error?.message ?? 'missing values' }
  return { config: { public_key: row.public_key, private_key: row.private_key, contact: row.contact }, error: null }
}

/** Throws when neither source yields a complete config. Never logs a value. */
export async function loadVapidConfig(
  db: Db,
  deps: { decrypt?: (s: string) => Promise<string> } = {},
): Promise<{ config: VapidConfig; source: VapidSource }> {
  if (cached) return cached

  const fromTableConfig = await fromTable(db, deps.decrypt ?? defaultDecrypt)
  if (fromTableConfig) {
    cached = { config: fromTableConfig, source: 'table' }
    return cached
  }

  const rpc = await fromRpc(db)
  if (rpc.config) {
    cached = { config: rpc.config, source: 'rpc' }
    return cached
  }

  throw new Error(`[push-sender] Could not load VAPID config from the table or Vault: ${rpc.error}`)
}
