// src/lib/action-engine/executors/send-email-template.ts
// Action executor: send_email_template (UFE-11)
// Loads an org-scoped email_templates row, fills its html_snapshot + subject
// with merge-tag variables, and sends via the SAME platform Resend path
// send_email uses (sendPlatformEmail). Registered in execute-action.ts.
//
// NOT in the DB action_type enum — dispatched via a pre-switch string branch
// in execute-action.ts, exactly like update_contact / contact_add_tag. This
// keeps the change CODE-ONLY (no enum migration).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { renderWithVariables } from '@/lib/email/merge-tags'
import { sendPlatformEmail } from '@/lib/email/resend'

export async function executeSendEmailTemplate(
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  const templateId = String(params.template_id ?? '')
  const to = String(params.to ?? '')
  const variables =
    params.variables && typeof params.variables === 'object' && !Array.isArray(params.variables)
      ? (params.variables as Record<string, unknown>)
      : {}
  // Subject may be provided inline, or fall back to a variables-driven value.
  const subjectInput = String(params.subject ?? '')

  if (!templateId) throw new Error('send_email_template requires "template_id"')
  if (!to) throw new Error('send_email_template requires "to"')

  // Load the template scoped to the org (RLS via the authenticated client; the
  // action-engine passes a service-role client, so filter org_id explicitly).
  const { data: template, error } = await supabase
    .from('email_templates')
    .select('id, name, html_snapshot')
    .eq('id', templateId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw new Error(`send_email_template failed to load template: ${error.message}`)
  if (!template) throw new Error(`send_email_template: template ${templateId} not found for org`)
  if (!template.html_snapshot) {
    throw new Error(`send_email_template: template ${templateId} has no html_snapshot (publish or save it first)`)
  }

  // Personalize both the subject and the rendered HTML.
  const subject = renderWithVariables(subjectInput || template.name || '', variables)
  const html = renderWithVariables(template.html_snapshot, variables)

  const result = await sendPlatformEmail(to, subject, html)
  if (result.error) throw new Error(`send_email_template failed: ${result.error}`)
  return `Template email sent. ID: ${result.id ?? 'unknown'}`
}
