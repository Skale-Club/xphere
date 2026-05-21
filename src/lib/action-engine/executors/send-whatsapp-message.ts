// src/lib/action-engine/executors/send-whatsapp-message.ts
// Executor for the `send_whatsapp_message` action type.
//
// Agents call this tool to send a WhatsApp message to a specific phone number.
// Resolves the org's active Evolution Go instance, formats the text via the
// WhatsApp adapter (1600-char splits, native markup preserved), and sends.
//
// Result is always a single line | no newlines (Vapi response parser breaks on \n).

import { sendWhatsappMessage } from '@/lib/evolution/send-message'
import type { ActionContext } from '@/lib/action-engine/execute-action'

export async function sendWhatsappMessageAction(
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<string> {
  const to = String(params.to ?? params.phone ?? params.number ?? '').trim()
  const text = String(params.message ?? params.text ?? params.body ?? '').trim()
  const instanceName = params.instance_name ? String(params.instance_name) : undefined

  if (!to) throw new Error('send_whatsapp_message requires a "to" phone number parameter.')
  if (!text) throw new Error('send_whatsapp_message requires a "message" text parameter.')

  const result = await sendWhatsappMessage({
    orgId: ctx.organizationId,
    to,
    text,
    instanceName,
  })

  if (!result.ok) {
    throw new Error(result.error ?? 'Evolution Go send failed')
  }

  return `WhatsApp message sent. IDs: ${result.messageIds.join(',') || '(none)'}`
}
