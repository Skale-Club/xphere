// src/lib/action-engine/executors/send-whatsapp-template.ts
// Executor for the `send_whatsapp_template` action type (Meta Cloud API).
//
// Distinct from `send-whatsapp-message.ts` (Evolution / Z-API / W-API):
//   - This one ONLY uses the official Meta Cloud API
//   - Requires an APPROVED template (no free text)
//   - Works outside the 24-hour customer service window
//
// Result is always a single line (no newlines).

import { sendCloudTemplate } from '@/lib/whatsapp/cloud/send-template'
import { getActiveCloudAccount } from '@/lib/whatsapp/cloud/resolve-account'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { ActionContext } from '@/lib/action-engine/execute-action'

export async function sendWhatsappTemplateAction(
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<string> {
  const to = String(params.to ?? params.phone ?? params.number ?? '').trim()
  const templateId = String(params.template_id ?? params.templateId ?? '').trim()
  const bodyValues = Array.isArray(params.body_values)
    ? (params.body_values as unknown[]).map((v) => String(v))
    : []
  const headerValues = Array.isArray(params.header_values)
    ? (params.header_values as unknown[]).map((v) => String(v))
    : []

  if (!to) throw new Error('send_whatsapp_template requires a "to" phone number parameter.')
  if (!templateId) throw new Error('send_whatsapp_template requires a "template_id" parameter.')

  const account = await getActiveCloudAccount(ctx.organizationId)
  if (!account) {
    throw new Error(
      'No active WhatsApp Cloud account. Connect Meta Cloud in Integrations → WhatsApp Official.',
    )
  }

  const supabase = createServiceRoleClient()
  const { data: template } = await supabase
    .from('whatsapp_templates')
    .select('name, language, status, body_variable_count, header_variable_count')
    .eq('id', templateId)
    .eq('org_id', ctx.organizationId)
    .maybeSingle()

  if (!template) throw new Error(`Template not found (id=${templateId}).`)
  if (template.status !== 'APPROVED') {
    throw new Error(`Template is ${template.status} — only APPROVED templates can be sent.`)
  }
  if (bodyValues.length !== template.body_variable_count) {
    throw new Error(
      `Template body expects ${template.body_variable_count} variables; received ${bodyValues.length}.`,
    )
  }
  if (headerValues.length !== template.header_variable_count) {
    throw new Error(
      `Template header expects ${template.header_variable_count} variables; received ${headerValues.length}.`,
    )
  }

  const result = await sendCloudTemplate({
    account,
    to,
    templateName: template.name,
    language: template.language,
    bodyVariables: bodyValues,
    headerVariables: headerValues,
  })

  if (!result.ok) {
    throw new Error(`${result.error}${result.code ? ` (code ${result.code})` : ''}`)
  }

  return `WhatsApp template sent. wamid: ${result.wamid}`
}
