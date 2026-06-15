// src/lib/zernio/register-webhook.ts
// Registers or updates the Xphere webhook endpoint with Zernio.
// Called when a Zernio integration is saved/activated for an org.
//
// Zernio webhook REST contract (verified against the live API + docs):
//   POST  /webhooks/settings  -> create  (returns { webhook: {...} })
//   PUT   /webhooks/settings  -> update  (returns { webhook: {...} })
//   GET   /webhooks/settings  -> read    (returns { webhook: {...} })
// Webhook settings are a SINGLETON per account — there is no /webhooks/{id}
// collection. The `_id` in the response is informational only; it never
// travels in the URL path. (The `/webhooks` and `/webhooks/{id}` paths shown
// in zernio.com/openapi.yaml are not deployed and return 404.)

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

/** Both create/update and read responses wrap the object as { webhook: {...} }. */
interface ZernioWebhookResponse extends ZernioWebhook {
  webhook?: ZernioWebhook
}

const WEBHOOK_SETTINGS_PATH = '/webhooks/settings'

export const SUBSCRIBED_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'comment.received',
  'whatsapp.template.status_updated',
] as const

/** Unwraps the { webhook: {...} } envelope, tolerating a bare object too. */
function unwrap(data: ZernioWebhookResponse): ZernioWebhook {
  return data.webhook ?? data
}

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

  // Settings are a singleton: update in place once it exists, otherwise create.
  // The id never goes in the URL — the path is always /webhooks/settings.
  const method = existingWebhookId ? 'PUT' : 'POST'
  const written = unwrap(
    await zernioFetchJson<ZernioWebhookResponse>(WEBHOOK_SETTINGS_PATH, method, body, apiKey),
  )

  const webhookId = written._id ?? written.id ?? existingWebhookId
  if (!webhookId) {
    throw new Error('Zernio did not return a webhook id.')
  }

  // Verify the subscription actually reflects what we asked for. Prefer the
  // events echoed by the write response; fall back to a read if absent.
  let confirmedEvents = Array.isArray(written.events) ? written.events : undefined
  if (!confirmedEvents) {
    try {
      const read = unwrap(
        await zernioFetchJson<ZernioWebhookResponse>(WEBHOOK_SETTINGS_PATH, 'GET', null, apiKey),
      )
      confirmedEvents = Array.isArray(read.events) ? read.events : []
    } catch {
      confirmedEvents = []
    }
  }

  const missingEvents = SUBSCRIBED_EVENTS.filter((e) => !confirmedEvents!.includes(e))

  return { webhookId, confirmedEvents, missingEvents }
}
