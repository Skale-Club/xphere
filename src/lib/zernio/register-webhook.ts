// src/lib/zernio/register-webhook.ts
// Registers (or updates) the Xphere webhook endpoint with Zernio.
// Called when a Zernio integration is saved/activated for an org.
// Endpoint: POST /v1/webhook-settings

import { zernioFetchJson } from './client'

interface RegisterWebhookResult {
  webhookId: string
}

interface ZernioWebhookResponse {
  _id?: string
  id?: string
}

const SUBSCRIBED_EVENTS = [
  'message.received',
  'comment.received',
]

export async function registerZernioWebhook(
  apiKey: string,
  webhookUrl: string,
  webhookSecret: string,
): Promise<RegisterWebhookResult> {
  const data = await zernioFetchJson<ZernioWebhookResponse>(
    '/webhook-settings',
    'POST',
    {
      url: webhookUrl,
      secret: webhookSecret,
      events: SUBSCRIBED_EVENTS,
    },
    apiKey,
  )

  return { webhookId: data?._id ?? data?.id ?? '' }
}
