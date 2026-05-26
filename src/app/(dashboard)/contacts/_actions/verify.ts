'use server'

/**
 * markContactVerified — Phase 110 Plan 03 (CID-14, D-01, D-01a).
 *
 * Manual verification path: an org admin promotes a contact whose
 * identity_status is 'identified' to 'verified' by clicking "Mark verified"
 * in contact-info-panel. The action:
 *
 *   1. Inserts an audit row into contact_verifications (RLS gates this to
 *      org admins — see migration 1062). Re-verification of the same
 *      (org, contact, identifier_type, identifier_value) triple returns
 *      23505 from the UNIQUE constraint, which we treat as idempotent
 *      success (Pitfall 6).
 *   2. ONLY after the INSERT succeeds (or 23505), runs a conditional
 *      UPDATE on contacts that bumps identity_status from 'identified' to
 *      'verified'. The WHERE clause includes `identity_status='identified'`
 *      so channel_only / merge_conflict / archived_duplicate / verified
 *      rows are never touched (D-01 invariant + Pitfall 2).
 *
 * Auth: cached getUser() per CLAUDE.md (never call supabase.auth.getUser()
 * directly). RLS on contact_verifications enforces the admin gate; we do
 * not duplicate that check here.
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'

export interface MarkContactVerifiedInput {
  contactId: string
  identifierType: 'phone' | 'email'
  identifierValue: string
  method?: 'manual' | 'sms_reply' | 'email_click' | 'oauth'
}

export type MarkContactVerifiedResult =
  | { ok: true }
  | { ok: false; error: string }

export async function markContactVerified(
  input: MarkContactVerifiedInput,
): Promise<MarkContactVerifiedResult> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No organization found' }

  // Step 1: insert verification row. RLS enforces admin gate.
  const { error: insErr } = await supabase
    .from('contact_verifications')
    .insert({
      org_id: orgId,
      contact_id: input.contactId,
      identifier_type: input.identifierType,
      identifier_value: input.identifierValue,
      method: input.method ?? 'manual',
      verified_by: user.id,
    })

  // Pitfall 6: if the INSERT failed for any reason OTHER than the UNIQUE
  // collision (23505 = "already verified" = idempotent success), return
  // an error and SKIP the UPDATE. Otherwise a non-admin caller rejected
  // by RLS would still see their contact's status bumped.
  if (insErr && insErr.code !== '23505') {
    return { ok: false, error: insErr.message }
  }

  // Step 2: conditional status bump. WHERE identity_status='identified'
  // means channel_only / merge_conflict / archived_duplicate / verified
  // are no-ops (D-01 + Pitfall 2).
  const { error: updErr } = await supabase
    .from('contacts')
    .update({ identity_status: 'verified' })
    .eq('id', input.contactId)
    .eq('identity_status', 'identified')

  if (updErr) {
    // Verification row is in; only the status bump failed. Log + soft fail.
    console.error(
      `[markContactVerified] status bump failed contact_id=${input.contactId}: ${updErr.message}`,
    )
  }

  // Pitfall 10: revalidate /contacts so the conflict filter counter and
  // any list-page identity_status rendering pick up the new state.
  revalidatePath('/contacts')
  return { ok: true }
}
