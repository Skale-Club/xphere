/**
 * Send a template message via the Meta Cloud API.
 *
 *   POST /{phone-number-id}/messages
 *   { messaging_product: "whatsapp", to: "<E164 no '+'>", type: "template",
 *     template: { name, language: {code}, components: [...] } }
 *
 * Variable arrays follow the order of `{{n}}` placeholders in the template
 * body. Header variables (if any) live in a separate component block.
 */

import { metaFetch, MetaApiException } from './client'
import type { CloudAccount, MetaSendResult } from './types'

export interface SendTemplateInput {
  account: CloudAccount
  /** Recipient phone in E.164 (with or without leading +). */
  to: string
  templateName: string
  language: string
  /** Body variables in {{n}} order. */
  bodyVariables?: string[]
  /** Header variables (text only — image/video headers TBD). */
  headerVariables?: string[]
}

export async function sendCloudTemplate(input: SendTemplateInput): Promise<
  { ok: true; wamid: string } | { ok: false; error: string; code?: number }
> {
  const to = input.to.replace(/^\+/, '').replace(/\D/g, '')
  if (!to) return { ok: false, error: 'Invalid recipient phone' }

  const components: Array<Record<string, unknown>> = []
  if (input.headerVariables && input.headerVariables.length > 0) {
    components.push({
      type: 'header',
      parameters: input.headerVariables.map((v) => ({ type: 'text', text: v })),
    })
  }
  if (input.bodyVariables && input.bodyVariables.length > 0) {
    components.push({
      type: 'body',
      parameters: input.bodyVariables.map((v) => ({ type: 'text', text: v })),
    })
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.language },
      ...(components.length > 0 ? { components } : {}),
    },
  }

  try {
    const res = await metaFetch<MetaSendResult>(
      input.account,
      `/${input.account.phoneNumberId}/messages`,
      { method: 'POST', body },
    )
    const wamid = res.messages?.[0]?.id
    if (!wamid) return { ok: false, error: 'Meta returned no message id' }
    return { ok: true, wamid }
  } catch (err) {
    if (err instanceof MetaApiException) {
      return { ok: false, error: err.metaError.message, code: err.metaError.code }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Send failed' }
  }
}
