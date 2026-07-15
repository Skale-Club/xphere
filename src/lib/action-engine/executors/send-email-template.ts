// src/lib/action-engine/executors/send-email-template.ts
// Action executor: send_email_template (UFE-11)
// Loads an org-scoped email_templates row, fills its html_snapshot/plain_text_snapshot
// + subject with merge-tag variables, and sends via sendTenantEmail — the SAME
// compliance path used by send_tenant_email and dashboard replies: suppression
// list, org-address footer, and List-Unsubscribe/one-click headers for
// kind:'marketing' sends. Registered in execute-action.ts.
//
// NOT in the DB action_type enum — dispatched via a pre-switch string branch
// in execute-action.ts, exactly like update_contact / contact_add_tag. This
// keeps the change CODE-ONLY (no enum migration).
//
// Deliberate behavior change (email-builder-hardening Phase 2): orgs without a
// connected tenant Resend integration will now get a clear error from
// sendTenantEmail instead of silently sending via the platform Resend key.
//
// Phase 3 addition: subject resolution is now a fallback chain —
// params.subject (override) wins; when omitted/blank, the template's own
// `subject_line` column (set in the builder's Document inspector) is used;
// only when BOTH are empty does this throw. Still never silently falls back
// to the template *name* — that was the original Finding #7 bug.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { renderWithVariables } from '@/lib/email/merge-tags'
import { sendTenantEmail, type EmailKind } from '@/lib/email/resend'

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

  // Subject override — resolved against the template's own subject_line
  // AFTER the template loads (see the fallback chain below). Not required
  // yet at this point; only "no subject anywhere" is an error.
  const subjectOverride = typeof params.subject === 'string' ? params.subject.trim() : ''

  // kind: defaults to 'marketing' (suppression + compliance footer + one-click
  // unsubscribe). 'transactional' is an explicit escape hatch for non-marketing
  // sends (e.g. receipts, confirmations) triggered through this executor.
  if (
    params.kind !== undefined &&
    params.kind !== 'marketing' &&
    params.kind !== 'transactional'
  ) {
    throw new Error(
      `send_email_template: invalid "kind" (${JSON.stringify(params.kind)}) — must be "marketing" or "transactional"`,
    )
  }
  const kind: EmailKind = params.kind === 'transactional' ? 'transactional' : 'marketing'

  const allowDraft = params.allow_draft === true

  if (!templateId) throw new Error('send_email_template requires "template_id"')
  if (!to) throw new Error('send_email_template requires "to"')

  // Load the template scoped to the org (RLS via the authenticated client; the
  // action-engine passes a service-role client, so filter org_id explicitly).
  const { data: template, error } = await supabase
    .from('email_templates')
    .select('id, name, status, subject_line, html_snapshot, plain_text_snapshot')
    .eq('id', templateId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw new Error(`send_email_template failed to load template: ${error.message}`)
  if (!template) throw new Error(`send_email_template: template ${templateId} not found for org`)
  if (!template.html_snapshot) {
    throw new Error(`send_email_template: template ${templateId} has no html_snapshot (publish or save it first)`)
  }

  // Published gate: drafts (with a possibly-stale snapshot) require an explicit opt-in.
  if (template.status !== 'published' && !allowDraft) {
    throw new Error(
      `send_email_template: template ${templateId} is not published — publish the template first or pass allow_draft: true`,
    )
  }

  // Subject fallback chain: params.subject wins; otherwise fall back to the
  // template's stored subject_line (set in the builder's Document inspector).
  // Still never silently falls back to the template *name* — throw a clear
  // error instead when neither is set.
  const templateSubject = typeof template.subject_line === 'string' ? template.subject_line.trim() : ''
  const resolvedSubjectInput = subjectOverride || templateSubject
  if (!resolvedSubjectInput) {
    throw new Error(
      `send_email_template requires "subject" — pass a subject or set the template's subject line first (template ${templateId} has neither)`,
    )
  }

  // Personalize subject, HTML, and (when available) the plain-text part.
  const subject = renderWithVariables(resolvedSubjectInput, variables)
  const html = renderWithVariables(template.html_snapshot, variables)
  const text = template.plain_text_snapshot
    ? renderWithVariables(template.plain_text_snapshot, variables)
    : undefined

  const result = await sendTenantEmail(orgId, to, subject, html, undefined, { kind, text })

  if (result.error) throw new Error(`send_email_template failed: ${result.error}`)
  if (result.skipped) return `Skipped: recipient unsubscribed (${to})`
  return `Template email sent. ID: ${result.id ?? 'unknown'}`
}
