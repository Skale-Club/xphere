// src/lib/zernio/register-webhook.ts
// Registers or updates the Xphere webhook endpoint with Zernio.
// Called when a Zernio integration is saved/activated for an org.
// Endpoint: POST/PUT /v1/webhooks/settings

import { zernioFetchJson } from './client'

interface RegisterWebhookResult {
  webhookId: string
}

interface ZernioWebhookResponse {
  success?: boolean
  webhook?: {
    _id?: string
    id?: string
  }
}

const SUBSCRIBED_EVENTS = [
  'message.received',
  'comment.received',
]

export async function registerZernioWebhook(
  apiKey: string,
  webhookUrl: string,
  webhookSecret: string,
  existingWebhookId?: string,
): Promise<RegisterWebhookResult> {
  const data = await zernioFetchJson<ZernioWebhookResponse>(
    '/webhooks/settings',
    existingWebhookId ? 'PUT' : 'POST',
    {
      ...(existingWebhookId ? { _id: existingWebhookId } : {}),
      name: 'Xphere Inbox',
      url: webhookUrl,
      secret: webhookSecret,
      events: SUBSCRIBED_EVENTS,
      isActive: true,
    },
    apiKey,
  )

  return { webhookId: data.webhook?._id ?? data.webhook?.id ?? existingWebhookId ?? '' }
}
