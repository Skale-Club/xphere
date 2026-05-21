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
 * Never returns encrypted_api_key | only safe display fields.
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

/**
 * Fetch the list of flows for the authenticated org's ManyChat channel.
 *
 * Mirrors testManychatConnection | same decrypt + AbortController 5s pattern.
 * Returns { flows: Array<{name: string; ns: string}> } on success,
 * { error: string } on any failure.
 *
 * Called client-side from RuleFormSheet via useEffect on sheet open (D-02).
 */
export async function getManychatFlows(): Promise<
  { flows: Array<{ name: string; ns: string }> } | { error: string }
> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  const { data: channel } = await supabase
    .from('manychat_channels')
    .select('encrypted_api_key')
    .single()

  if (!channel) return { error: 'No ManyChat channel configured.' }

  let apiKey: string
  try {
    apiKey = await decrypt(channel.encrypted_api_key)
  } catch {
    return { error: 'Failed to decrypt credentials.' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch('https://api.manychat.com/fb/page/getFlows', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })

    if (!response.ok) {
      return { error: `ManyChat returned status ${response.status}` }
    }

    const json = (await response.json()) as {
      status: string
      data: Array<{ id: number; name: string; ns: string }>
    }

    const flows = (json.data ?? []).map((f) => ({ name: f.name, ns: f.ns }))
    return { flows }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'Connection timed out after 5 seconds.' }
    }
    return { error: err instanceof Error ? err.message : 'Unknown error.' }
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
 * - Does NOT set `org_id` manually | RLS `WITH CHECK (org_id = get_current_org_id())`
 *   handles tenant scoping automatically for the authenticated client.
 *
 * Phase 25 (D-03/D-04/D-05): ALSO inserts a bridge `integrations` row with
 * provider='manychat' linked back via `manychat_channel_id`. The bridge row
 * carries the credentials so `tool_configs.integration_id → integrations` joins
 * resolve transparently for outbound actions. The encrypted blob is REUSED |
 * never re-encrypted (would change the IV with no benefit).
 *
 * On bridge-insert failure, the just-created channel row is deleted (compensating
 * delete) so the two tables never diverge. Open Question 4 in 25-RESEARCH.md.
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

  // 1. Canonical insert (manychat_channels) | capture the inserted id
  const { data: channel, error: channelErr } = await supabase
    .from('manychat_channels')
    .insert({
      channel_name: data.channelName,
      encrypted_api_key: encryptedApiKey,
      key_hint: keyHint,
      webhook_secret: webhookSecret,
      is_active: true,
      config: {},
    })
    .select('id')
    .single()

  if (channelErr || !channel) {
    return { error: channelErr?.message ?? 'Failed to create channel.' }
  }

  // 2. Bridge insert (integrations) | same encrypted blob, FK back to channel.
  //    Resolve organization_id from org_members (same pattern as integrations/actions.ts).
  const { data: member, error: memberErr } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (memberErr || !member) {
    // Compensating delete | channel insert succeeded but we can't resolve org for bridge.
    await supabase.from('manychat_channels').delete().eq('id', channel.id)
    return { error: 'Bridge sync failed: could not resolve organization.' }
  }

  const { error: bridgeErr } = await supabase.from('integrations').insert({
    organization_id: member.organization_id,
    provider: 'manychat',
    name: data.channelName,
    encrypted_api_key: encryptedApiKey, // reuse | never re-encrypt
    key_hint: keyHint,
    location_id: null,
    config: {},
    is_active: true,
    manychat_channel_id: channel.id,
  })

  if (bridgeErr) {
    // Compensating delete | keep manychat_channels and integrations consistent.
    await supabase.from('manychat_channels').delete().eq('id', channel.id)
    return { error: `Bridge sync failed: ${bridgeErr.message}` }
  }

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

  // The integrations bridge row is removed automatically via the
  // manychat_channel_id ON DELETE CASCADE FK (migration 028). No manual
  // bridge delete needed here.
  const { error } = await supabase
    .from('manychat_channels')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
}
