// Executor: send_zernio_dm
// Sends a private DM to the author of an Instagram or Facebook comment
// via the Zernio Inbox API. Designed to be triggered from the
// event:comment.received workflow trigger using {{comment.conversation_id}}.
//
// Flow:
//   1. Fetch the comment conversation → read channel_metadata
//      (account_id, participant_id, platform, zernio_post_id)
//   2. POST /inbox/contacts/{participantId}/dm to find/create a DM conversation
//   3. POST /inbox/conversations/{conversationId}/messages to send the text

import { zernioFetchJson } from '@/lib/zernio/client'
import { sendZernioDm } from '@/lib/zernio/send-dm'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { ActionContext } from '@/lib/action-engine/execute-action'

interface ZernioContactDmResponse {
  success?: boolean
  data?: {
    conversationId?: string
    id?: string
  }
}

async function findOrCreateZernioDmConversation(
  participantId: string,
  accountId: string,
  apiKey: string,
): Promise<string> {
  const data = await zernioFetchJson<ZernioContactDmResponse>(
    `/inbox/contacts/${encodeURIComponent(participantId)}/dm`,
    'POST',
    { accountId },
    apiKey,
  )
  const conversationId = data.data?.conversationId ?? data.data?.id
  if (!conversationId) throw new Error('Zernio did not return a DM conversation ID')
  return conversationId
}

export async function executeSendZernioDm(
  params: Record<string, unknown>,
  ctx?: ActionContext,
): Promise<string> {
  const { organizationId, supabase: ctxSupabase } = ctx ?? {}
  if (!organizationId) throw new Error('send_zernio_dm requires ctx.organizationId')

  const conversationId = typeof params.conversation_id === 'string' ? params.conversation_id : null
  const message = typeof params.message === 'string' ? params.message.trim() : ''

  if (!conversationId) throw new Error('send_zernio_dm: conversation_id is required')
  if (!message) throw new Error('send_zernio_dm: message is required')

  const supabase = ctxSupabase ?? createServiceRoleClient()

  // 1. Fetch comment conversation → channel_metadata
  const { data: conv } = await supabase
    .from('conversations')
    .select('channel_metadata')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conv) throw new Error(`send_zernio_dm: conversation ${conversationId} not found`)

  const meta = (conv.channel_metadata ?? {}) as Record<string, string | null>
  const accountId = meta.account_id
  const participantId = meta.participant_id

  if (!accountId || !participantId) {
    throw new Error('send_zernio_dm: conversation is missing account_id or participant_id in channel_metadata')
  }

  // 2. Get Zernio API key
  const serviceClient = createServiceRoleClient()
  const apiKey = await getProviderKey('zernio', organizationId, serviceClient)
  if (!apiKey) throw new Error('send_zernio_dm: Zernio integration not configured')

  // 3. Find or create DM conversation in Zernio for this participant
  const zernioConversationId = await findOrCreateZernioDmConversation(participantId, accountId, apiKey)

  // 4. Send the DM
  await sendZernioDm(zernioConversationId, accountId, message, apiKey)

  return JSON.stringify({ ok: true, zernio_conversation_id: zernioConversationId })
}
