'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encrypt, maskApiKey } from '@/lib/crypto'

/**
 * Create a ManyChat channel.
 *
 * - Encrypts the raw API key via AES-256-GCM (`encrypt`) before insert.
 * - Stores `••••••••last4` masked hint via `maskApiKey` for UI display.
 * - Generates a per-channel `webhook_secret` (Web Crypto UUID v4) for the
 *   `X-Operator-Secret` header gate on `/api/manychat/webhook`.
 * - Does NOT set `org_id` manually — RLS `WITH CHECK (org_id = get_current_org_id())`
 *   handles tenant scoping automatically for the authenticated client.
 */
export async function createManychatChannel(data: {
  channelName: string
  apiKey: string
}): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  const encryptedApiKey = await encrypt(data.apiKey)
  const keyHint = maskApiKey(data.apiKey)
  const webhookSecret = crypto.randomUUID()

  const { error } = await supabase.from('manychat_channels').insert({
    channel_name: data.channelName,
    encrypted_api_key: encryptedApiKey,
    key_hint: keyHint,
    webhook_secret: webhookSecret,
    is_active: true,
    config: {},
  })

  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
}

/**
 * Delete a ManyChat channel by id.
 *
 * RLS ensures only rows belonging to the user's active org are reachable.
 */
export async function deleteManychatChannel(
  id: string
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  const { error } = await supabase
    .from('manychat_channels')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
}
