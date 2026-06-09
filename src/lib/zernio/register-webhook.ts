// src/lib/zernio/register-webhook.ts
// Registers or updates the Xphere webhook endpoint with Zernio.
// Called when a Zernio integration is saved/activated for an org.
//
// Zernio webhook REST contract (https://zernio.com/openapi.yaml):
//   POST   /webhooks        -> create  (201, returns the Webhook object)
//   PATCH  /webhooks/{id}   -> update  (200, returns the Webhook object) — id in URL
//   GET    /webhooks/{id}   -> read    (200, returns the Webhook object)
// The webhook id travels in the URL path, NOT in the body. The previous
// implementation PUT `{ _id }` to `/webhooks/settings`, which is not a real
// endpoint — Zernio ignored the body, so the events list never updated.

import { zernioFetchJson } from './client'

interface RegisterWebhookResult {
  webhookId: string
  /** Events Zernio confirmed are subscribed after the write. */
  confirmedEvents: string[]
  /** Events we asked for but Zernio did not persist (drift / invalid names). */
  missingEvents: string[]
}

interface ZernioWebhook {
  _id?: string
  id?: string
  name?: string
  url?: string
  events?: string[]
  isActive?: boolean
}

export const SUBSCRIBED_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'comment.received',
  'whatsapp.template.status_updated',
] as const

export async function registerZernioWebhook(
  apiKey: string,
  webhookUrl: string,
  webhookSecret: string,
  existingWebhookId?: string,
): Promise<RegisterWebhookResult> {
  const body = {
    name: 'Xphere Inbox',
    url: webhookUrl,
    secret: webhookSecret,
    events: [...SUBSCRIBED_EVENTS],
    isActive: true,
  }

  const data = existingWebhookId
    ? await zernioFetchJson<ZernioWebhook>(`/webhooks/${existingWebhookId}`, 'PATCH', body, apiKey)
    : await zernioFetchJson<ZernioWebhook>('/webhooks', 'POST', body, apiKey)

  const webhookId = data._id ?? data.id ?? existingWebhookId
  if (!webhookId) {
    throw new Error('Zernio did not return a webhook id.')
  }

  // Verify the subscription actually reflects what we asked for. Prefer the
  // events echoed by the write response; fall back to a read if absent.
  let confirmedEvents = Array.isArray(data.events) ? data.events : undefined
  if (!confirmedEvents) {
    try {
      const read = await zernioFetchJson<ZernioWebhook>(`/webhooks/${webhookId}`, 'GET', null, apiKey)
      confirmedEvents = Array.isArray(read.events) ? read.events : []
    } catch {
      confirmedEvents = []
    }
  }

  const missingEvents = SUBSCRIBED_EVENTS.filter((e) => !confirmedEvents!.includes(e))

  return { webhookId, confirmedEvents, missingEvents }
}
