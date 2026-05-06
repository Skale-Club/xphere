// src/lib/action-engine/log-action.ts
// Writes an action_logs row after the action result is dispatched.
// IMPORTANT: This function MUST be safe to call without try/catch — it never throws.
// Returns the inserted action_logs.id on success, or null on any failure.
// The Vapi caller (in vapi/tools/route.ts) ignores the return value; the ManyChat
// dispatcher uses it to populate manychat_events.action_log_id (ROUTING-04).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

export interface LogActionPayload {
  organization_id: string
  tool_config_id: string | null
  vapi_call_id: string
  tool_name: string
  status: 'success' | 'error' | 'timeout'
  execution_ms: number
  request_payload: Json
  response_payload: Json
  error_detail: string | null
}

export async function logAction(
  payload: LogActionPayload,
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('action_logs')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data?.id) return null
    return data.id
  } catch (err) {
    console.error('[logAction] Failed to write action_logs row:', {
      error: err instanceof Error ? err.message : String(err),
      vapi_call_id: payload.vapi_call_id,
      tool_name: payload.tool_name,
    })
    return null
  }
}
