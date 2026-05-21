// src/lib/manychat/add-tag.ts
// Endpoint: POST https://api.manychat.com/fb/subscriber/addTag
// Body:     { subscriber_id, tag_id }
// Source:   ManyChat PHP SDK | same Subscriber namespace as setCustomField

import { manychatFetchJson, type ManychatCredentials } from './client'
import { resolveSubscriberId } from './subscriber-id'

interface AddTagParams {
  subscriber_id?: string | number
  tag_id?: string | number
  [key: string]: unknown
}

export async function addManychatTag(
  params: Record<string, unknown>,
  credentials: ManychatCredentials,
): Promise<string> {
  const subscriberId = resolveSubscriberId(params)
  const { tag_id: tagId } = params as AddTagParams
  if (!tagId) throw new Error('tag_id is required for manychat_add_tag')

  await manychatFetchJson(
    '/fb/subscriber/addTag',
    'POST',
    { subscriber_id: subscriberId, tag_id: tagId },
    credentials,
  )

  return `Tag ${tagId} added to subscriber ${subscriberId}.`
}
