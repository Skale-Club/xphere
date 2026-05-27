/**
 * Resolve the active WhatsApp Cloud account for an org.
 *
 * Reads `whatsapp_cloud_accounts` (via SECURITY DEFINER service role since we
 * call this from webhook handlers too where RLS context is absent) and
 * decrypts the stored tokens for runtime use. Returns null if no active
 * account is connected.
 */

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import type { CloudAccount } from './types'

export async function getActiveCloudAccount(orgId: string): Promise<CloudAccount | null> {
  if (!orgId) return null
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('whatsapp_cloud_accounts')
    .select('id, org_id, display_name, waba_id, phone_number_id, phone_number_e164, access_token_encrypted, app_secret_encrypted, status')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) return null
  return hydrate(data)
}

export async function getCloudAccountByPhoneNumberId(
  phoneNumberId: string,
): Promise<CloudAccount | null> {
  if (!phoneNumberId) return null
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('whatsapp_cloud_accounts')
    .select('id, org_id, display_name, waba_id, phone_number_id, phone_number_e164, access_token_encrypted, app_secret_encrypted, status')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle()

  if (error || !data) return null
  return hydrate(data)
}

type Row = {
  id: string
  org_id: string
  display_name: string
  waba_id: string
  phone_number_id: string
  phone_number_e164: string | null
  access_token_encrypted: string
  app_secret_encrypted: string | null
  status: 'connected' | 'disconnected' | 'error'
}

async function hydrate(row: Row): Promise<CloudAccount> {
  const accessToken = await decrypt(row.access_token_encrypted)
  const appSecret = row.app_secret_encrypted ? await decrypt(row.app_secret_encrypted) : null
  return {
    id: row.id,
    orgId: row.org_id,
    displayName: row.display_name,
    wabaId: row.waba_id,
    phoneNumberId: row.phone_number_id,
    phoneNumberE164: row.phone_number_e164,
    accessToken,
    appSecret,
    status: row.status,
  }
}
