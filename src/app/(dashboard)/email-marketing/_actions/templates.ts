'use server'

// @deprecated Legacy /email-marketing system, retired in favor of the
// block-based builder at /settings/email-templates
// (src/app/(dashboard)/email-templates/actions.ts). Dead code — its only
// callers (src/components/email-marketing/*) are themselves unreachable now
// that every /email-marketing route redirects. Retained deliberately during
// the deprecation window; scheduled for deletion once production data
// confirms no org used the legacy system. Do not build new features against
// this. See .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database } from '@/types/database'

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

export type EmailTemplateRow = Database['public']['Tables']['email_templates']['Row']
export type EmailTemplateSectionRow = Database['public']['Tables']['email_template_sections']['Row']

// ─── List ─────────────────────────────────────────────────────────────────────

export async function getEmailTemplates(): Promise<ActionResult<EmailTemplateRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

// ─── Get one with sections ────────────────────────────────────────────────────

export type TemplateWithSections = EmailTemplateRow & {
  sections: EmailTemplateSectionRow[]
}

export async function getEmailTemplate(
  id: string,
): Promise<ActionResult<TemplateWithSections>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_templates')
    .select('*, email_template_sections(*)')
    .eq('id', id)
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }

  const sections = (data.email_template_sections as EmailTemplateSectionRow[] ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)

  return { ok: true, data: { ...data, sections } }
}

// ─── Create ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1).max(120),
  subject_line: z.string().max(200).default(''),
  preview_text: z.string().max(300).default(''),
  status: z.enum(['draft', 'ready', 'archived']).default('draft'),
  tags: z.array(z.string()).default([]),
  ai_prompt: z.string().optional(),
})

export type EmailTemplateCreateInput = z.input<typeof createSchema>

export async function createEmailTemplate(
  input: EmailTemplateCreateInput,
): Promise<ActionResult<EmailTemplateRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const supabase = await createClient()
  const { data: orgData } = await supabase.rpc('get_current_org_id')
  if (!orgData) return { ok: false, error: 'no_active_org' }

  const { data, error } = await supabase
    .from('email_templates')
    .insert({ ...parsed.data, org_id: orgData as string })
    .select()
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'create_failed' }
  revalidatePath('/email-marketing')
  return { ok: true, data }
}

// ─── Update ───────────────────────────────────────────────────────────────────

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  subject_line: z.string().max(200).optional(),
  preview_text: z.string().max(300).optional(),
  status: z.enum(['draft', 'ready', 'archived']).optional(),
  tags: z.array(z.string()).optional(),
  ai_prompt: z.string().optional(),
})

export type EmailTemplateUpdateInput = z.infer<typeof updateSchema>

export async function updateEmailTemplate(
  id: string,
  input: EmailTemplateUpdateInput,
): Promise<ActionResult<EmailTemplateRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_templates')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }
  revalidatePath('/email-marketing')
  revalidatePath(`/email-marketing/${id}`)
  return { ok: true, data }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteEmailTemplate(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase.from('email_templates').delete().eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/email-marketing')
  return { ok: true, data: undefined }
}

// ─── Sections CRUD ────────────────────────────────────────────────────────────

const sectionUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  html_content: z.string().optional(),
  sort_order: z.number().int().optional(),
})

export async function upsertTemplateSection(
  templateId: string,
  section: Partial<EmailTemplateSectionRow> & { name: string; type: string; html_content: string; sort_order: number },
): Promise<ActionResult<EmailTemplateSectionRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  if (section.id) {
    const parsed = sectionUpdateSchema.safeParse(section)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

    const { data, error } = await supabase
      .from('email_template_sections')
      .update(parsed.data)
      .eq('id', section.id)
      .select()
      .single()

    if (error || !data) return { ok: false, error: error?.message ?? 'update_failed' }
    return { ok: true, data }
  }

  const { data, error } = await supabase
    .from('email_template_sections')
    .insert({
      template_id: templateId,
      section_id: section.section_id ?? null,
      type: section.type,
      name: section.name,
      html_content: section.html_content,
      sort_order: section.sort_order,
    })
    .select()
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'create_failed' }
  return { ok: true, data }
}

export async function deleteTemplateSection(sectionId: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase.from('email_template_sections').delete().eq('id', sectionId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

export async function reorderTemplateSections(
  updates: Array<{ id: string; sort_order: number }>,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabase.from('email_template_sections').update({ sort_order }).eq('id', id),
    ),
  )
  return { ok: true, data: undefined }
}
