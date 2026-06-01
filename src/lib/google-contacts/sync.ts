// lib/google-contacts/sync.ts
//
// One-way sync helper: platform contact → Google Contacts.
//
// Design decisions:
//  - Best-effort: errors are logged but never propagate to the caller.
//  - Gated: quick COUNT check before touching credentials. No-op when the
//    org has no active google_contacts integration.
//  - Timeout: capped at 5 s so a slow Google API call never hangs contact creation.
//  - Field mapping documented inline to make future extensions obvious.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createGoogleContact } from './create-contact'
import { updateGoogleContact } from './update-contact'
import type { ActionContext } from '@/lib/action-engine/execute-action'

export interface ContactSyncParams {
  // Name fields — compose in priority order: name → first+last → email prefix
  name?:       string | null
  first_name?: string | null
  last_name?:  string | null
  // Contact fields mapped directly to Google's People API
  email?:   string | null
  phone?:   string | null   // raw or E.164 — both accepted by the People API
  company?: string | null
  notes?:   string | null
}

// ── helpers ───────────────────────────────────────────────────────────────────

function composeName(p: ContactSyncParams): string | undefined {
  const explicit = p.name?.trim()
  if (explicit) return explicit
  const parts = [p.first_name?.trim(), p.last_name?.trim()].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  return undefined
}

/**
 * Returns true if the org has an active google_contacts integration.
 * Uses a HEAD/COUNT query — no decryption, very fast.
 */
async function hasGoogleContacts(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('integrations')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('provider', 'google_contacts')
    .eq('is_active', true)
  return (count ?? 0) > 0
}

const SYNC_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`google-contacts/sync: timeout after ${ms}ms`)), ms),
    ),
  ])
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Sync a newly created platform contact to Google Contacts.
 * No-op (and silent) when google_contacts is not connected for the org.
 * Wraps the API call in a 5-second timeout; never throws.
 *
 * Field mapping:
 *   platform.name / first_name + last_name → People API givenName + familyName
 *   platform.email                         → emailAddresses[0]
 *   platform.phone                         → phoneNumbers[0]
 *   platform.company                       → organizations[0].name
 *   platform.notes                         → biographies[0]
 */
export async function syncContactToGoogle(
  params: ContactSyncParams,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<void> {
  try {
    if (!(await hasGoogleContacts(supabase, orgId))) return

    const name = composeName(params)

    // Skip if there is nothing useful to send
    if (!name && !params.email && !params.phone) {
      console.log(
        `[google-contacts/sync] create skipped — no identifiable fields org_id=${orgId}`,
      )
      return
    }

    const ctx: ActionContext = { organizationId: orgId, supabase }

    const result = await withTimeout(
      createGoogleContact(
        {
          name,
          email:   params.email   ?? undefined,
          phone:   params.phone   ?? undefined,
          company: params.company ?? undefined,
          notes:   params.notes   ?? undefined,
        },
        ctx,
      ),
      SYNC_TIMEOUT_MS,
    )

    console.log(`[google-contacts/sync] created org_id=${orgId} result="${result}"`)
  } catch (err) {
    // Best-effort — never fail the caller
    console.error(
      `[google-contacts/sync] create failed org_id=${orgId}`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

/**
 * Sync an updated platform contact back to Google.
 * Locates the Google contact by email then patches changed fields.
 * No-op (and silent) when:
 *  - google_contacts is not connected for the org
 *  - the contact has no email (required to locate the Google record)
 * Never throws.
 */
export async function syncContactUpdateToGoogle(
  params: ContactSyncParams,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<void> {
  try {
    if (!params.email?.trim()) return // update requires email to locate the record
    if (!(await hasGoogleContacts(supabase, orgId))) return

    const name = composeName(params)
    const ctx: ActionContext = { organizationId: orgId, supabase }

    const result = await withTimeout(
      updateGoogleContact(
        {
          email:   params.email,
          name:    name            ?? undefined,
          phone:   params.phone   ?? undefined,
          company: params.company ?? undefined,
          notes:   params.notes   ?? undefined,
        },
        ctx,
      ),
      SYNC_TIMEOUT_MS,
    )

    console.log(`[google-contacts/sync] updated org_id=${orgId} result="${result}"`)
  } catch (err) {
    console.error(
      `[google-contacts/sync] update failed org_id=${orgId}`,
      err instanceof Error ? err.message : String(err),
    )
  }
}
