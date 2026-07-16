'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { EmailDocument } from '@/lib/email/render-template'
import { renderSignatureFragment, normalizeDocument } from '@/lib/email/render-template'
import { validateEmailDocument } from '@/lib/email/schema'
import { sanitizeEmailDocument } from '@/lib/email/sanitize'
import type { EmailSignatureRow, Json } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

const MAX_NAME_LENGTH = 120

// ─── listSignatures ─────────────────────────────────────────────────────────

export async function listSignatures(): Promise<ActionResult<EmailSignatureRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_signatures')
    .select('id, org_id, name, document, html_snapshot, plain_text_snapshot, is_default, created_by, created_at, updated_at')
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as EmailSignatureRow[] }
}

// ─── getSignature ─────────────────────────────────────────────────────────────

export async function getSignature(id: string): Promise<ActionResult<EmailSignatureRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_signatures')
    .select('id, org_id, name, document, html_snapshot, plain_text_snapshot, is_default, created_by, created_at, updated_at')
    .eq('id', id)
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }
  return { ok: true, data: data as EmailSignatureRow }
}

// ─── createSignature ──────────────────────────────────────────────────────────

export async function createSignature(name: string): Promise<ActionResult<{ id: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (!name.trim()) return { ok: false, error: 'name_required' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Name exceeds ${MAX_NAME_LENGTH} characters` }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data, error } = await supabase
    .from('email_signatures')
    .insert({
      org_id: orgId as string,
      name: name.trim(),
      document: {},
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'create_failed' }
  revalidatePath('/settings/signatures')
  return { ok: true, data: { id: data.id } }
}

// ─── saveSignature ────────────────────────────────────────────────────────────

/**
 * Canonical save pipeline, mirroring the email-template builder:
 *   normalizeDocument → validateEmailDocument → sanitizeEmailDocument
 *   → renderSignatureFragment → persist { document, html_snapshot, plain_text_snapshot }
 *
 * `renderSignatureFragment` (not `renderTemplate`) is used so the stored HTML
 * is a chrome-free inline-CSS fragment ready to append to an outbound body or
 * paste into Gmail/Outlook. Sanitize is NEVER skipped — a signature is user
 * HTML that lands in external mail clients.
 */
export async function saveSignature(
  id: string,
  document: EmailDocument | Record<string, unknown>,
  name?: string,
): Promise<ActionResult<{ html_snapshot: string; plain_text_snapshot: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  if (name !== undefined && name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name exceeds ${MAX_NAME_LENGTH} characters` }
  }

  const normalized = normalizeDocument(document)
  const validated = validateEmailDocument(normalized)
  if (!validated.ok) return { ok: false, error: validated.error }
  const sanitized = sanitizeEmailDocument(validated.doc)

  const { html, plainText } = renderSignatureFragment(sanitized)

  const supabase = await createClient()
  const patch: {
    document: Json
    html_snapshot: string
    plain_text_snapshot: string
    name?: string
  } = {
    document: sanitized as Json,
    html_snapshot: html,
    plain_text_snapshot: plainText,
  }
  if (name !== undefined) patch.name = name.trim()

  const { error } = await supabase.from('email_signatures').update(patch).eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/signatures')
  revalidatePath(`/settings/signatures/${id}`)
  // Return the canonical (sanitized + rendered) output so the editor can copy
  // and preview exactly what will be sent/pasted, not the raw client input.
  return { ok: true, data: { html_snapshot: html, plain_text_snapshot: plainText } }
}

// ─── renameSignature ──────────────────────────────────────────────────────────

export async function renameSignature(id: string, name: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (!name.trim()) return { ok: false, error: 'name_required' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Name exceeds ${MAX_NAME_LENGTH} characters` }

  const supabase = await createClient()
  const { error } = await supabase
    .from('email_signatures')
    .update({ name: name.trim() })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/signatures')
  revalidatePath(`/settings/signatures/${id}`)
  return { ok: true, data: undefined }
}

// ─── duplicateSignature ───────────────────────────────────────────────────────

export async function duplicateSignature(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data: original, error: fetchError } = await supabase
    .from('email_signatures')
    .select('name, document, html_snapshot, plain_text_snapshot, org_id')
    .eq('id', id)
    .single()

  if (fetchError || !original) return { ok: false, error: fetchError?.message ?? 'not_found' }

  // Copies are never default — the partial unique index allows only one, and a
  // duplicate silently stealing the default flag would be surprising.
  const { data, error } = await supabase
    .from('email_signatures')
    .insert({
      org_id: original.org_id,
      name: `${original.name} (copy)`,
      document: original.document ?? {},
      html_snapshot: original.html_snapshot ?? null,
      plain_text_snapshot: original.plain_text_snapshot ?? null,
      is_default: false,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'duplicate_failed' }
  revalidatePath('/settings/signatures')
  return { ok: true, data: { id: data.id } }
}

// ─── deleteSignature ──────────────────────────────────────────────────────────

export async function deleteSignature(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase.from('email_signatures').delete().eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/signatures')
  return { ok: true, data: undefined }
}

// ─── setDefaultSignature ──────────────────────────────────────────────────────

/**
 * Flag one signature as the org default (the one auto-appended to outbound
 * agent replies in Phase 3), or clear the flag with `makeDefault=false`.
 *
 * The DB enforces at most one default per org via a partial unique index, so
 * the current default MUST be cleared before a new one is set — otherwise the
 * second UPDATE trips the unique constraint. We unset-all-then-set (both writes
 * are org-scoped by RLS); a failure between the two leaves zero defaults, which
 * is a safe state.
 */
export async function setDefaultSignature(
  id: string,
  makeDefault = true,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Clear any existing default (RLS scopes this to the caller's org).
  const { error: clearError } = await supabase
    .from('email_signatures')
    .update({ is_default: false })
    .eq('is_default', true)

  if (clearError) return { ok: false, error: clearError.message }

  if (makeDefault) {
    const { error } = await supabase
      .from('email_signatures')
      .update({ is_default: true })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/settings/signatures')
  revalidatePath(`/settings/signatures/${id}`)
  return { ok: true, data: undefined }
}
