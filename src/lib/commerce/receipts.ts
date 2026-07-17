import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { CommerceEventPayload } from './ingestion-schema'

type ServiceClient = SupabaseClient<Database>
export type CommerceReceiptResult = { receiptId: string; duplicate: false } | { duplicate: true }

export async function insertCommerceReceipt(
  supabase: ServiceClient, orgId: string, payload: CommerceEventPayload,
): Promise<CommerceReceiptResult> {
  const { data, error } = await supabase
    .from('commerce_event_receipts')
    .insert({
      org_id: orgId,
      event_id: payload.event_id,
      type: payload.type,
      payload: payload as unknown as Json, // MAJOR units stored verbatim — no transform
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { duplicate: true } // UNIQUE(org_id,event_id) → replay
    throw error
  }
  return { receiptId: data!.id, duplicate: false }
}
