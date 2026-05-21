// src/lib/meta/send.ts
// Provider-aware Meta channel dispatcher. Resolves the active meta_channels
// row for (org_id, channel_type) and forwards to either the Direct (Graph API)
// or ManyChat transport depending on the row's `provider` column.
// SEED-032.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { sendMetaMessage } from './send-message'
import type { MetaOutboundMedia } from './types'

export interface SendMetaChannelMessageParams {
  orgId: string
  channel: 'messenger' | 'instagram'
  recipientId: string
  text: string
  media?: MetaOutboundMedia
}

export interface SendMetaChannelMessageResult {
  ok: boolean
  messageId?: string
  error?: string
}

/**
 * Looks up the single active meta_channels row for (org_id, channel_type) and
 * dispatches based on its `provider` column.
 */
export async function sendMetaChannelMessage(
  params: SendMetaChannelMessageParams,
): Promise<SendMetaChannelMessageResult> {
  const supabase = createServiceRoleClient()

  const { data: channelRow, error } = await supabase
    .from('meta_channels')
    .select('id, provider, encrypted_page_access_token')
    .eq('org_id', params.orgId)
    .eq('channel_type', params.channel)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.error('[meta/send] failed to resolve meta_channel:', error.message)
    return { ok: false, error: error.message }
  }

  if (!channelRow) {
    return { ok: false, error: 'No active Meta channel configured' }
  }

  const provider = channelRow.provider ?? 'direct'

  if (provider === 'manychat') {
    return sendViaManyChat(params)
  }

  return sendViaDirect(params, channelRow.encrypted_page_access_token)
}

async function sendViaDirect(
  params: SendMetaChannelMessageParams,
  encryptedPageToken: string,
): Promise<SendMetaChannelMessageResult> {
  try {
    const pageToken = await decrypt(encryptedPageToken)
    const result = await sendMetaMessage(
      pageToken,
      params.recipientId,
      params.text,
      params.media,
    )

    if ('error' in result) {
      return { ok: false, error: result.error }
    }

    return { ok: true, messageId: result.messageId }
  } catch (err) {
    console.error('[meta/send] direct dispatch error:', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Outbound via ManyChat is not implemented in SEED-032 | the dispatcher shape
 * exists so that flipping `provider='manychat'` switches transport cleanly
 * once ManyChat send is wired up.
 */
async function sendViaManyChat(
  _params: SendMetaChannelMessageParams,
): Promise<SendMetaChannelMessageResult> {
  return {
    ok: false,
    error: 'ManyChat outbound not implemented in this version',
  }
}
