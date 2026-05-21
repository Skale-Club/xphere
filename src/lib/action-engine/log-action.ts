// src/lib/action-engine/log-action.ts
// SEED-025 Phase F: action_logs table is now read-only for historical queries.
// This function is a no-op stub kept for call-site compatibility.
// All parameters are accepted but no DB write is performed.
// Returns null always (historical log IDs are no longer produced).

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function logAction(
  payload: LogActionPayload,
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  // No-op: action_logs writes stopped in SEED-025 Phase F.
  return null
}
