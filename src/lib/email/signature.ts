// Server-side helpers for applying stored email signatures to outbound mail.
//
// A signature is a per-org, block-built HTML fragment (see
// `renderSignatureFragment`). These helpers fetch the compiled `html_snapshot`
// and append it to an outbound email body, resolving any merge tags at send
// time. They are deliberately defensive: any miss (no signature, no snapshot,
// query error) returns the base HTML unchanged so a signature never breaks a
// send.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { renderWithVariables } from './merge-tags'

/** Visual gap between the message body and the signature. */
const SIGNATURE_SEPARATOR = '<br><br>'

/**
 * Fetch a specific signature's compiled HTML, scoped to the org. The explicit
 * `org_id` filter matters because dispatch may use a service-role client that
 * bypasses RLS.
 */
export async function fetchSignatureHtml(
  supabase: SupabaseClient<Database>,
  orgId: string,
  signatureId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_signatures')
    .select('html_snapshot')
    .eq('id', signatureId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) return null
  return data?.html_snapshot ?? null
}

/** Fetch the org's default signature HTML, if one is flagged. */
export async function fetchDefaultSignatureHtml(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_signatures')
    .select('html_snapshot')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .maybeSingle()
  if (error) return null
  return data?.html_snapshot ?? null
}

/**
 * Build the merge-tag variable bag for a signature from the contact + org.
 * Mirrors the canonical tag namespace (`contact.*`, `org.name`). Unknown tags
 * resolve to '' in `renderWithVariables`, so a signature never leaks raw
 * `{{ tokens }}`.
 */
export async function buildSignatureVars(
  supabase: SupabaseClient<Database>,
  orgId: string,
  contactId: string | null,
): Promise<Record<string, unknown>> {
  const vars: Record<string, unknown> = {}

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()
  if (org) vars.org = { name: org.name }

  if (contactId) {
    const { data: c } = await supabase
      .from('contacts')
      .select('first_name, last_name, name, email, phone, company')
      .eq('id', contactId)
      .maybeSingle()
    if (c) vars.contact = c
  }

  return vars
}

/**
 * Append `signatureHtml` (with merge tags resolved) to `baseHtml`. Returns
 * `baseHtml` unchanged when the resolved signature is empty.
 */
export function appendSignature(
  baseHtml: string,
  signatureHtml: string,
  vars?: Record<string, unknown>,
): string {
  const resolved = vars ? renderWithVariables(signatureHtml, vars) : signatureHtml
  if (!resolved.trim()) return baseHtml
  return `${baseHtml}${SIGNATURE_SEPARATOR}${resolved}`
}
