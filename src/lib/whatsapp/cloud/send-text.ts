/**
 * Send a free-text WhatsApp message via the Meta Cloud API.
 *
 * Only allowed inside the 24-hour customer service window (i.e. the customer
 * has messaged us in the last 24h). Outside that window Meta returns error
 * 131047 — caller is expected to handle the fallback (e.g. require template).
 *
 * Used by the chat agent reply dispatcher when responding to inbound on a
 * Cloud-connected conversation.
 */

import { metaFetch, MetaApiException } from './client'
import type { CloudAccount, MetaSendResult } from './types'

export async function sendCloudText({
  account,
  to,
  body,
}: {
  account: CloudAccount
  to: string
  body: string
}): Promise<
  | { ok: true; wamid: string }
  | { ok: false; error: string; code?: number; outsideWindow?: boolean }
> {
  const recipient = to.replace(/^\+/, '').replace(/\D/g, '')
  if (!recipient) return { ok: false, error: 'Invalid recipient phone' }

  try {
    const res = await metaFetch<MetaSendResult>(
      account,
      `/${account.phoneNumberId}/messages`,
      {
        method: 'POST',
        body: {
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'text',
          text: { preview_url: false, body },
        },
      },
    )
    const wamid = res.messages?.[0]?.id
    if (!wamid) return { ok: false, error: 'Meta returned no message id' }
    return { ok: true, wamid }
  } catch (err) {
    if (err instanceof MetaApiException) {
      const outsideWindow = err.metaError.code === 131047
      return {
        ok: false,
        error: err.metaError.message,
        code: err.metaError.code,
        outsideWindow,
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Send failed' }
  }
}
