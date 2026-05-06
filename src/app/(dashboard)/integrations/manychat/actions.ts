'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encrypt, maskApiKey, decrypt } from '@/lib/crypto'
import type { ManychatChannelForDisplay } from './constants'

export type { ManychatChannelForDisplay } from './constants'

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

/**
 * Get the ManyChat channel for the authenticated org.
 *
 * Returns null if not authenticated or no channel is configured.
 * Never returns encrypted_api_key — only safe display fields.
 */
export async function getManychatChannel(): Promise<ManychatChannelForDisplay | null> {
  const user = await getUser()
  if (!user) return null

  const supabase = await createClient()

  const { data } = await supabase
    .from('manychat_channels')
    .select('id, channel_name, key_hint, webhook_secret, is_active, created_at')
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id,
    channelName: data.channel_name,
    keyHint: data.key_hint ?? '••••••••',
    webhookSecret: data.webhook_secret,
    isActive: data.is_active,
    createdAt: data.created_at,
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Test the ManyChat API connection for the authenticated org's channel.
 *
 * Decrypts the stored API key and calls GET /fb/page/getFlows with a 5s timeout.
 */
export async function testManychatConnection(): Promise<{ success: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = await createClient()

  const { data: channel } = await supabase
    .from('manychat_channels')
    .select('encrypted_api_key')
    .single()

  if (!channel) return { success: false, error: 'No ManyChat channel configured.' }

  let apiKey: string
  try {
    apiKey = await decrypt(channel.encrypted_api_key)
  } catch {
    return { success: false, error: 'Failed to decrypt credentials.' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch('https://api.manychat.com/fb/page/getFlows', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })

    if (response.ok) return { success: true }
    return { success: false, error: `ManyChat returned status ${response.status}` }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Connection timed out after 5 seconds.' }
    }
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error.' }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

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
