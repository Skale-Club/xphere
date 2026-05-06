// src/lib/manychat/dispatch-event.ts
// Inbound ManyChat event dispatcher.
//
// Called inline by /api/manychat/webhook AFTER the event row has been inserted
// (with status='unmatched'). This module finds the first matching rule, resolves
// the bound tool_config, decrypts the integration credentials, executes the action
// via the existing action engine, logs to action_logs, and finally updates the
// manychat_events row with the resolved status + matched_rule_id + action_log_id.
//
// Contract: NEVER throws. All failure modes write status='error' to the event row.
// The webhook handler can call this without a try/catch wrapper.
//
// Note: vapi_call_id on action_logs is repurposed as `manychat:${eventId}` for
// ManyChat-sourced rows. This satisfies the NOT NULL constraint without renaming
// the column. Phase 26 UI can branch on the prefix to display the source.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { resolveRule } from './resolve-rule'
import { resolveToolById } from '@/lib/action-engine/resolve-tool-by-id'
import { executeAction } from '@/lib/action-engine/execute-action'
import { decrypt } from '@/lib/crypto'

export interface DispatchInput {
  eventId: string         // manychat_events.id (already inserted by webhook)
  orgId: string           // resolved from channel.org_id — NEVER from request body
  channelId: string
  eventType: string
  payload: Record<string, unknown>
}

export async function dispatchManychatEvent(
  input: DispatchInput,
  supabase: SupabaseClient<Database>
): Promise<void> {
  const startedAt = Date.now()

  // 1. Find the first matching rule (priority order, condition containment)
  const rule = await resolveRule(
    input.orgId,
    input.channelId,
    input.eventType,
    input.payload,
    supabase
  )
  if (!rule) {
    // Already 'unmatched' from the webhook insert — leave as-is.
    return
  }

  // 2. Resolve the bound tool_config + integration credentials
  const tool = await resolveToolById(rule.tool_config_id, supabase)
  if (!tool) {
    // Rule matched, but the bound tool is missing or inactive — error path.
    await markEvent(supabase, input.eventId, {
      status: 'error',
      matched_rule_id: rule.id,
    })
    return
  }

  // 3. Execute the action — wrapped because executors throw on timeout/failure
  let result = ''
  let status: 'success' | 'error' | 'timeout' = 'success'
  let errorDetail: string | null = null

  try {
    const apiKey = await decrypt(tool.integrations.encrypted_api_key)
    const credentials = {
      apiKey,
      locationId: tool.integrations.location_id ?? '',
    }
    result = await executeAction(
      tool.action_type,
      input.payload,
      credentials,
      { organizationId: input.orgId, supabase }
    )
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    status = isTimeout ? 'timeout' : 'error'
    errorDetail = err instanceof Error ? err.message : String(err)
    result = tool.fallback_message
  }

  // 4. Insert into action_logs and capture the id (for ROUTING-04 link)
  // vapi_call_id is NOT NULL — use a synthetic 'manychat:{event_id}' prefix.
  const { data: logRow } = await supabase
    .from('action_logs')
    .insert({
      organization_id: input.orgId,
      tool_config_id: tool.id,
      vapi_call_id: `manychat:${input.eventId}`,
      tool_name: tool.tool_name,
      status,
      execution_ms: Date.now() - startedAt,
      request_payload: input.payload as Json,
      response_payload: { result } as Json,
      error_detail: errorDetail,
    })
    .select('id')
    .single()

  const actionLogId = logRow?.id ?? null

  // 5. Link the event to the log + final status
  await markEvent(supabase, input.eventId, {
    status: status === 'success' ? 'matched' : 'error',
    matched_rule_id: rule.id,
    action_log_id: actionLogId,
  })
}

/**
 * Service-role-only update of manychat_events. Authenticated clients have no
 * UPDATE policy; this function relies on the supabase argument being the
 * service-role client created by the webhook handler.
 */
async function markEvent(
  supabase: SupabaseClient<Database>,
  eventId: string,
  updates: Database['public']['Tables']['manychat_events']['Update']
): Promise<void> {
  await supabase
    .from('manychat_events')
    .update(updates)
    .eq('id', eventId)
}
