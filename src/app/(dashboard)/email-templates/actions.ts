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

export interface ReusableBlock {
  id: string
  org_id: string
  name: string
  block_type: string
  document: Record<string, unknown>
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

// ─── saveReusableBlock ────────────────────────────────────────────────────────

export async function saveReusableBlock(
  name: string,
  blockType: string,
  document: Record<string, unknown>,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  if (!name.trim()) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { error } = await supabase
    .from('reusable_email_blocks')
    .insert({
      org_id: orgId as string,
      name: name.trim(),
      block_type: blockType,
      document: document as Json,
    })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

// ─── getReusableBlocks ────────────────────────────────────────────────────────

export async function getReusableBlocks(): Promise<ActionResult<ReusableBlock[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reusable_email_blocks')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as ReusableBlock[] }
}

// ─── deleteReusableBlock ──────────────────────────────────────────────────────

export async function deleteReusableBlock(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase.from('reusable_email_blocks').delete().eq('id', id)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
