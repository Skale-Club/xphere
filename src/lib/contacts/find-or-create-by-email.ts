// src/lib/contacts/find-or-create-by-email.ts
// THE single canonical email-based contact upsert — extracted from the two
// prior inline copies (src/lib/commerce/events.ts's emitCommerceEvent step 1,
// src/lib/leads/ingest.ts's findContact+insert). Every future email-based
// contact lookup/create should call this instead of forking a new copy
// (137-04, UIX-03, orchestrator Q1 ruling). Does NOT emit contact.created and
// does NOT touch conversations — callers own those side effects, keeping this
// helper reusable across the chat route and (test-gated) commerce events.
// See .planning/research/INTEGRATION-CONTRACT.md and 137-RESEARCH.md Pattern 4.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { normaliseEmail } from '@/lib/contacts/zod-schemas'

export interface FindOrCreateContactOptions {
  lifecycleStage?: Database['public']['Tables']['contacts']['Insert']['lifecycle_stage'] // default 'lead'
  sourceType?: string | null
  sourceId?: string | null
  firstName?: string | null
  lastName?: string | null
  name?: string | null
}

export async function findOrCreateContactByEmail(
  supabase: SupabaseClient<Database>,
  orgId: string,
  email: string | null | undefined,
  options?: FindOrCreateContactOptions,
): Promise<{ contactId: string | null; created: boolean; email: string | null }> {
  const norm = normaliseEmail(email)
  if (!norm) return { contactId: null, created: false, email: null }

  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('org_id', orgId)
    .eq('email_normalized', norm)
    .neq('identity_status', 'archived_duplicate')
    .maybeSingle()

  if (existing) return { contactId: existing.id, created: false, email: norm }

  const insertPayload: Database['public']['Tables']['contacts']['Insert'] = {
    org_id: orgId,
    email: norm,
    source: 'api', // 'api' is the closest existing enum value — do NOT add a new one
    lifecycle_stage: options?.lifecycleStage ?? 'lead',
  }
  if (options?.sourceType !== undefined) insertPayload.source_type = options.sourceType
  if (options?.sourceId !== undefined) insertPayload.source_id = options.sourceId
  if (options?.firstName !== undefined) insertPayload.first_name = options.firstName
  if (options?.lastName !== undefined) insertPayload.last_name = options.lastName
  if (options?.name !== undefined) insertPayload.name = options.name

  const { data: created, error } = await supabase.from('contacts').insert(insertPayload).select('id').single()

  if (!error && created) return { contactId: created.id, created: true, email: norm }

  // Insert race — re-select by email_normalized (mirrors leads/ingest.ts:105).
  const { data: raced } = await supabase
    .from('contacts')
    .select('id')
    .eq('org_id', orgId)
    .eq('email_normalized', norm)
    .neq('identity_status', 'archived_duplicate')
    .maybeSingle()

  if (raced) return { contactId: raced.id, created: false, email: norm }
  return { contactId: null, created: false, email: norm }
}
