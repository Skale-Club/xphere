'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { EmailDocument } from '@/lib/email/render-template'
import {
  renderTemplate, normalizeDocument, normalizeSectionTemplateDoc,
} from '@/lib/email/render-template'
import { validateEmailDocument, validateSectionTemplateDoc } from '@/lib/email/schema'
import { sanitizeEmailDocument, sanitizeSectionTemplateDoc } from '@/lib/email/sanitize'
import { sendTenantEmail } from '@/lib/email/resend'
import type { Json } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailTemplateBuilderRow {
  id: string
  org_id: string
  name: string
  description: string | null
  status: string
  /** Subject line / inbox preview text — existing `email_templates` columns
   *  (migration 1097), not document jsonb fields: they predate this editor
   *  and are reused rather than duplicated into the document. */
  subject_line: string
  preview_text: string
  document: EmailDocument | Record<string, unknown>
  html_snapshot: string | null
  plain_text_snapshot: string | null
  folder_id: string | null
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
}

// Soft caps on the subject/preview columns — generous for real email use
// (RFC 2822 recommends wrapping subject lines around 78 chars, hard-caps
// around 998) while still rejecting a pathological paste.
const MAX_SUBJECT_LENGTH = 998
const MAX_PREVIEW_LENGTH = 500

export interface SectionTemplate {
  id: string
  org_id: string
  name: string
  section_type: string
  document: Record<string, unknown>
  folder_id: string | null
  position: number
  created_at: string
  updated_at: string
}

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

// ─── listTemplates ────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<ActionResult<EmailTemplateBuilderRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, org_id, name, description, status, subject_line, preview_text, document, html_snapshot, plain_text_snapshot, folder_id, position, created_by, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as EmailTemplateBuilderRow[] }
}

// ─── getTemplate ──────────────────────────────────────────────────────────────

export async function getTemplate(id: string): Promise<ActionResult<EmailTemplateBuilderRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, org_id, name, description, status, subject_line, preview_text, document, html_snapshot, plain_text_snapshot, created_by, created_at, updated_at')
    .eq('id', id)
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }
  return { ok: true, data: data as EmailTemplateBuilderRow }
}

// ─── createTemplate ───────────────────────────────────────────────────────────

export async function createTemplate(name: string): Promise<ActionResult<{ id: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  if (!name.trim()) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      org_id: orgId as string,
      name: name.trim(),
      status: 'draft',
      document: {},
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'create_failed' }
  revalidatePath('/email-templates')
  return { ok: true, data: { id: data.id } }
}

// ─── saveTemplate ─────────────────────────────────────────────────────────────

export async function saveTemplate(
  id: string,
  document: EmailDocument | Record<string, unknown>,
  name?: string,
  subjectLine?: string,
  previewText?: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const validated = validateEmailDocument(document)
  if (!validated.ok) return { ok: false, error: validated.error }
  const sanitized = sanitizeEmailDocument(validated.doc)

  if (subjectLine !== undefined && subjectLine.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, error: `Subject exceeds ${MAX_SUBJECT_LENGTH} characters` }
  }
  if (previewText !== undefined && previewText.length > MAX_PREVIEW_LENGTH) {
    return { ok: false, error: `Preview text exceeds ${MAX_PREVIEW_LENGTH} characters` }
  }

  // The html/plain-text snapshot embeds the subject as <title> and the
  // preview text as the hidden preheader — only meaningful when the caller
  // (the editor) passes the current values on every save, autosave included.
  const { html, plainText } = renderTemplate(sanitized, { subject: subjectLine, previewText })

  const supabase = await createClient()
  const updatePayload: {
    document: Json
    html_snapshot: string
    plain_text_snapshot: string
    name?: string
    subject_line?: string
    preview_text?: string
  } = {
    document: sanitized as Json,
    html_snapshot: html,
    plain_text_snapshot: plainText,
  }
  if (name !== undefined) updatePayload.name = name.trim()
  if (subjectLine !== undefined) updatePayload.subject_line = subjectLine.trim()
  if (previewText !== undefined) updatePayload.preview_text = previewText.trim()

  const { error } = await supabase
    .from('email_templates')
    .update(updatePayload)
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/email-templates')
  revalidatePath(`/email-templates/${id}`)
  return { ok: true, data: undefined }
}

// ─── publishTemplate ──────────────────────────────────────────────────────────

export async function publishTemplate(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Load the current document + name so we can refresh the published snapshot
  // and run a light pre-publish check.
  const { data: current, error: fetchError } = await supabase
    .from('email_templates')
    .select('name, document, subject_line, preview_text')
    .eq('id', id)
    .single()

  if (fetchError || !current) return { ok: false, error: fetchError?.message ?? 'not_found' }

  // Light pre-publish validation: must have a name and at least one section.
  // normalizeDocument runs BEFORE schema validation: legacy rows (saved before
  // Phase 118 / before this hardening) have blocks and sections without ids,
  // which the zod schema would otherwise reject with a cryptic "id: Required".
  // Normalizing also backfills those ids permanently on publish.
  const doc = normalizeDocument(current.document ?? {})
  if (!current.name?.trim()) return { ok: false, error: 'name_required' }
  if (doc.sections.length === 0) {
    return { ok: false, error: 'empty_document' }
  }

  const validated = validateEmailDocument(doc)
  if (!validated.ok) return { ok: false, error: validated.error }
  const sanitized = sanitizeEmailDocument(validated.doc)

  // Refresh the snapshot so the published HTML matches the current document.
  // Also write back the sanitized document — this is the one path that
  // guarantees a legacy (pre-hardening) stored document gets cleaned up.
  const { html, plainText } = renderTemplate(sanitized, {
    subject: current.subject_line ?? undefined,
    previewText: current.preview_text ?? undefined,
  })

  const { error } = await supabase
    .from('email_templates')
    .update({
      status: 'published',
      document: sanitized as Json,
      html_snapshot: html,
      plain_text_snapshot: plainText,
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/email-templates')
  revalidatePath(`/email-templates/${id}`)
  revalidatePath('/settings/email-templates')
  revalidatePath(`/settings/email-templates/${id}`)
  return { ok: true, data: undefined }
}

// ─── unpublishTemplate ────────────────────────────────────────────────────────

export async function unpublishTemplate(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('email_templates')
    .update({ status: 'draft' })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/email-templates')
  revalidatePath(`/email-templates/${id}`)
  revalidatePath('/settings/email-templates')
  revalidatePath(`/settings/email-templates/${id}`)
  return { ok: true, data: undefined }
}

// ─── deleteTemplate ───────────────────────────────────────────────────────────

export async function deleteTemplate(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase.from('email_templates').delete().eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/email-templates')
  return { ok: true, data: undefined }
}

// ─── duplicateTemplate ────────────────────────────────────────────────────────

export async function duplicateTemplate(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  const { data: original, error: fetchError } = await supabase
    .from('email_templates')
    .select('name, status, document, html_snapshot, plain_text_snapshot, subject_line, preview_text, org_id')
    .eq('id', id)
    .single()

  if (fetchError || !original) return { ok: false, error: fetchError?.message ?? 'not_found' }

  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      org_id: original.org_id,
      name: `${original.name} (copy)`,
      status: 'draft',
      document: original.document ?? {},
      html_snapshot: original.html_snapshot ?? null,
      plain_text_snapshot: original.plain_text_snapshot ?? null,
      subject_line: original.subject_line ?? '',
      preview_text: original.preview_text ?? '',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'duplicate_failed' }
  revalidatePath('/email-templates')
  return { ok: true, data: { id: data.id } }
}

// ─── saveSectionTemplate ──────────────────────────────────────────────────────

export async function saveSectionTemplate(
  name: string,
  document: Record<string, unknown>,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  if (!name.trim()) return { ok: false, error: 'name_required' }

  // Upgrade-on-write: accepts either the legacy `{ blocks }` fragment or the
  // modern `{ section }` shape (full layout/background/padding) and always
  // persists the modern shape — see normalizeSectionTemplateDoc.
  const normalized = normalizeSectionTemplateDoc(document)
  const validated = validateSectionTemplateDoc(normalized)
  if (!validated.ok) return { ok: false, error: validated.error }
  const sanitizedDoc = sanitizeSectionTemplateDoc(validated.doc)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { error } = await supabase
    .from('email_section_templates')
    .insert({
      org_id: orgId as string,
      name: name.trim(),
      section_type: 'custom',
      document: sanitizedDoc as Json,
    })

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/email-templates')
  return { ok: true, data: undefined }
}

// ─── listSectionTemplates ─────────────────────────────────────────────────────

export async function listSectionTemplates(): Promise<ActionResult<SectionTemplate[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_section_templates')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as SectionTemplate[] }
}

// ─── getSectionTemplate (one) ─────────────────────────────────────────────────

export async function getSectionTemplate(id: string): Promise<ActionResult<SectionTemplate>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_section_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }
  return { ok: true, data: data as SectionTemplate }
}

// ─── createSectionTemplate (from scratch) ─────────────────────────────────────

export async function createSectionTemplate(
  name: string,
  folderId: string | null = null,
): Promise<ActionResult<{ id: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (!name.trim()) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data, error } = await supabase
    .from('email_section_templates')
    .insert({
      org_id: orgId as string,
      name: name.trim(),
      section_type: 'custom',
      document: normalizeSectionTemplateDoc({}) as Json,
      folder_id: folderId,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'create_failed' }
  revalidatePath('/settings/email-templates')
  return { ok: true, data: { id: data.id } }
}

// ─── renameSectionTemplate ────────────────────────────────────────────────────

export async function renameSectionTemplate(id: string, name: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (!name.trim()) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('email_section_templates')
    .update({ name: name.trim() })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/email-templates')
  return { ok: true, data: undefined }
}

// ─── updateSectionTemplateType (inline type editor) ───────────────────────────

export async function updateSectionTemplateType(
  id: string,
  sectionType: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('email_section_templates')
    .update({ section_type: sectionType })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/email-templates')
  revalidatePath(`/settings/email-templates/sections/${id}`)
  return { ok: true, data: undefined }
}

// ─── updateSectionTemplate (document from the section editor) ──────────────────

export async function updateSectionTemplate(
  id: string,
  document: Record<string, unknown>,
  name?: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const normalized = normalizeSectionTemplateDoc(document)
  const validated = validateSectionTemplateDoc(normalized)
  if (!validated.ok) return { ok: false, error: validated.error }
  const sanitizedDoc = sanitizeSectionTemplateDoc(validated.doc)

  const supabase = await createClient()
  const patch: { document: Json; name?: string } = { document: sanitizedDoc as Json }
  if (name !== undefined) patch.name = name.trim()

  const { error } = await supabase
    .from('email_section_templates')
    .update(patch)
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/email-templates')
  revalidatePath(`/settings/email-templates/sections/${id}`)
  return { ok: true, data: undefined }
}

// ─── deleteSectionTemplate ────────────────────────────────────────────────────

export async function deleteSectionTemplate(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase.from('email_section_templates').delete().eq('id', id)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

// ─── sendTestEmail ────────────────────────────────────────────────────────────

/**
 * Sends the template to the signed-in user's own email as a one-off test.
 * Renders the CURRENT document fresh (not the possibly-stale html_snapshot),
 * so unsaved-but-persisted edits from the last autosave are reflected. Uses
 * the same tenant-integration send path as the compliant executor
 * (Phase 2 — sendTenantEmail), but as kind:'transactional' since a test send
 * to yourself is not a marketing send (no suppression check, no unsubscribe
 * footer) — the "[TEST]" subject prefix is the operative signal instead.
 */
export async function sendTestEmail(templateId: string): Promise<ActionResult<{ id?: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (!user.email) return { ok: false, error: 'Your account has no email address to send the test to' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data: row, error } = await supabase
    .from('email_templates')
    .select('name, document, subject_line, preview_text')
    .eq('id', templateId)
    .single()

  if (error || !row) return { ok: false, error: error?.message ?? 'not_found' }

  const doc = normalizeDocument(row.document ?? {})
  const validated = validateEmailDocument(doc)
  if (!validated.ok) return { ok: false, error: validated.error }
  const sanitized = sanitizeEmailDocument(validated.doc)

  const { html, plainText } = renderTemplate(sanitized, {
    subject: row.subject_line ?? undefined,
    previewText: row.preview_text ?? undefined,
  })

  const baseSubject = row.subject_line?.trim() || row.name
  const subject = `[TEST] ${baseSubject}`

  const result = await sendTenantEmail(orgId as string, user.email, subject, html, undefined, {
    kind: 'transactional',
    text: plainText,
  })

  if (result.error) return { ok: false, error: result.error }
  return { ok: true, data: { id: result.id } }
}
