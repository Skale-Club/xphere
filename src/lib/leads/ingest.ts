import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { normaliseEmail, normalisePhone } from '@/lib/contacts/zod-schemas'
import { hashLeadPayload, type LeadIngestionPayload } from '@/lib/leads/ingestion-schema'

type ServiceClient = SupabaseClient<Database>

export type LeadIngestionResult = {
  receiptId: string
  contactId: string
  contactAction: 'created' | 'updated' | 'unchanged'
  eventAction: 'accepted' | 'duplicate'
}

export class LeadIngestionConflictError extends Error {
  constructor() {
    super('Idempotency key was already used with a different payload')
  }
}

async function findContact(
  supabase: ServiceClient,
  orgId: string,
  phone: string | null,
  email: string | null,
): Promise<{ id: string } | null> {
  if (phone) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone_e164', phone)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) return data
  }
  if (email) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('email_normalized', email)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) return data
  }
  return null
}

export async function ingestLead(
  supabase: ServiceClient,
  orgId: string,
  payload: LeadIngestionPayload,
): Promise<LeadIngestionResult> {
  const payloadHash = hashLeadPayload(payload)
  const { data: existingReceipt } = await supabase
    .from('lead_ingestions')
    .select('id, contact_id, payload_hash')
    .eq('org_id', orgId)
    .eq('source_product', payload.source.product)
    .eq('external_event_id', payload.event_id)
    .maybeSingle()

  if (existingReceipt) {
    if (existingReceipt.payload_hash !== payloadHash) throw new LeadIngestionConflictError()
    return {
      receiptId: existingReceipt.id,
      contactId: existingReceipt.contact_id,
      contactAction: 'unchanged',
      eventAction: 'duplicate',
    }
  }

  const phone = normalisePhone(payload.contact.phone)
  const email = normaliseEmail(payload.contact.email)
  let contact = await findContact(supabase, orgId, phone, email)
  let contactAction: 'created' | 'updated' = 'updated'

  if (contact) {
    const patch: Database['public']['Tables']['contacts']['Update'] = {
      updated_at: new Date().toISOString(),
    }
    if (payload.contact.name) patch.name = payload.contact.name
    if (phone) patch.phone = phone
    if (email) patch.email = email
    const { error } = await supabase.from('contacts').update(patch).eq('id', contact.id).eq('org_id', orgId)
    if (error) throw new Error('Failed to update contact')
  } else {
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        org_id: orgId,
        name: payload.contact.name ?? null,
        phone,
        email,
        source: 'api',
        lifecycle_stage: 'lead',
        source_type: payload.source.product,
        source_id: payload.event_id,
        source_payload: { tenant_ref: payload.source.tenant_ref } as Json,
      })
      .select('id')
      .single()

    if (error || !data) {
      contact = await findContact(supabase, orgId, phone, email)
      if (!contact) throw new Error('Failed to create contact')
    } else {
      contact = data
      contactAction = 'created'
    }
  }

  const { data: receipt, error: receiptError } = await supabase
    .from('lead_ingestions')
    .insert({
      org_id: orgId,
      source_product: payload.source.product,
      source_tenant_ref: payload.source.tenant_ref,
      external_event_id: payload.event_id,
      schema_version: payload.schema_version,
      contact_id: contact.id,
      occurred_at: payload.occurred_at,
      payload: payload as unknown as Json,
      payload_hash: payloadHash,
    })
    .select('id, contact_id, payload_hash')
    .single()

  if (receiptError || !receipt) {
    const { data: racedReceipt } = await supabase
      .from('lead_ingestions')
      .select('id, contact_id, payload_hash')
      .eq('org_id', orgId)
      .eq('source_product', payload.source.product)
      .eq('external_event_id', payload.event_id)
      .maybeSingle()
    if (!racedReceipt) throw new Error('Failed to persist lead receipt')
    if (racedReceipt.payload_hash !== payloadHash) throw new LeadIngestionConflictError()
    return {
      receiptId: racedReceipt.id,
      contactId: racedReceipt.contact_id,
      contactAction: 'unchanged',
      eventAction: 'duplicate',
    }
  }

  return {
    receiptId: receipt.id,
    contactId: receipt.contact_id,
    contactAction,
    eventAction: 'accepted',
  }
}
