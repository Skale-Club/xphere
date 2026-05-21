// src/lib/manychat/set-field.ts
// Endpoint: POST https://api.manychat.com/fb/subscriber/setCustomField
// Body:     { subscriber_id, field_id, field_value }
// Source:   ManyChat PHP SDK | https://manychat.github.io/manychat-api-php/source-class-ManyChat.Structure.Fb.Subscriber.html

import { manychatFetchJson, type ManychatCredentials } from './client'
import { resolveSubscriberId } from './subscriber-id'

interface SetFieldParams {
  subscriber_id?: string | number
  field_id?: string | number
  field_value?: unknown          // string | number | bool | null | array | ManyChat coerces
  [key: string]: unknown
}

export async function setManychatField(
  params: Record<string, unknown>,
  credentials: ManychatCredentials,
): Promise<string> {
  const subscriberId = resolveSubscriberId(params)
  const { field_id: fieldId, field_value: fieldValue } = params as SetFieldParams
  if (!fieldId) throw new Error('field_id is required for manychat_set_field')
  // field_value MAY be empty string / 0 / false | only reject undefined.
  if (fieldValue === undefined) throw new Error('field_value is required for manychat_set_field')

  await manychatFetchJson(
    '/fb/subscriber/setCustomField',
    'POST',
    { subscriber_id: subscriberId, field_id: fieldId, field_value: fieldValue },
    credentials,
  )

  return `Field ${fieldId} set on subscriber ${subscriberId}.`
}
