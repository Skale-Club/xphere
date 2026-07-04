'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { EmailDocument } from '@/lib/email/render-template'
import { renderTemplate } from '@/lib/email/render-template'
import type { Json } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailTemplateBuilderRow {
  id: string
  org_id: string
  name: string
  description: string | null
  status: string
  document: EmailDocument | Record<string, unknown>
  html_snapshot: string | null
  plain_text_snapshot: string | null
  folder_id: string | null
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
}

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
    .select('id, org_id, name, description, status, document, html_snapshot, plain_text_snapshot, folder_id, position, created_by, created_at, updated_at')
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
    .select('id, org_id, name, description, status, document, html_snapshot, plain_text_snapshot, created_by, created_at, updated_at')
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
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const { html, plainText } = renderTemplate(document as EmailDocument)

  const supabase = await createClient()
  const updatePayload: {
    document: Json
    html_snapshot: string
    plain_text_snapshot: string
    name?: string
  } = {
    document: document as Json,
    html_snapshot: html,
    plain_text_snapshot: plainText,
  }
  if (name !== undefined) updatePayload.name = name.trim()

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
    .select('name, document')
    .eq('id', id)
    .single()

  if (fetchError || !current) return { ok: false, error: fetchError?.message ?? 'not_found' }

  // Light pre-publish validation: must have a name and at least one section.
  const doc = (current.document ?? {}) as EmailDocument
  if (!current.name?.trim()) return { ok: false, error: 'name_required' }
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) {
    return { ok: false, error: 'empty_document' }
  }

  // Refresh the snapshot so the published HTML matches the current document.
  const { html, plainText } = renderTemplate(doc)

  const { error } = await supabase
    .from('email_templates')
    .update({
      status: 'published',
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
    .select('name, status, document, html_snapshot, plain_text_snapshot, org_id')
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

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { error } = await supabase
    .from('email_section_templates')
    .insert({
      org_id: orgId as string,
      name: name.trim(),
      section_type: 'custom',
      document: document as Json,
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
      document: { blocks: [] },
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

  const supabase = await createClient()
  const patch: { document: Json; name?: string } = { document: document as Json }
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
