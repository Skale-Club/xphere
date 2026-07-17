// src/lib/agent-runtime/idempotency.ts
// Idempotency helpers for side-effecting tool executors.
// IDEMP-01: tool_idempotency_keys table (exists from migration 038)
// IDEMP-02: check before execute, persist after execute
// IDEMP-03: key = sha256(invocationId + ':' + toolCallIndex)

import crypto from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/obs/logger'

// ---------------------------------------------------------------------------
// IDEMP-03: Key derivation
// ---------------------------------------------------------------------------

export function deriveIdempotencyKey(invocationId: string, toolCallIndex: number): string {
  return crypto.createHash('sha256').update(`${invocationId}:${toolCallIndex}`).digest('hex')
}

// ---------------------------------------------------------------------------
// Side-effecting action types that require idempotency (IDEMP-02)
// ---------------------------------------------------------------------------

export const SIDE_EFFECTING_ACTIONS = new Set([
  'create_appointment',
  'send_sms',
  'create_contact',
  'custom_webhook',  // non-GET only | checked at call site via toolConfig
  'medusa_add_to_cart',
  'medusa_update_cart_item',
  // Phase 135 (WSL-02): wishlist writes are side-effecting for idempotency
  // purposes, but deliberately NOT in COMMERCE_WRITE_ACTIONS below -- they
  // stay out of the cart-only 3/turn + 25/conversation guardrail caps. The
  // wishlist read/list tool is intentionally absent from this set.
  'medusa_wishlist_add',
  'medusa_wishlist_remove',
])

// ---------------------------------------------------------------------------
// CRT-02/134-RESEARCH: commerce write action types. Exported separately so
// run-agent's tool loop can recognize a commerce write BEFORE dispatch (to
// enforce the per-turn cap via checkCommerceWritesPerTurn in guardrails.ts)
// without re-deriving the set from SIDE_EFFECTING_ACTIONS each time.
// ---------------------------------------------------------------------------

export const COMMERCE_WRITE_ACTIONS = new Set(['medusa_add_to_cart', 'medusa_update_cart_item'])

export function requiresIdempotency(actionType: string, toolConfig?: unknown): boolean {
  if (!SIDE_EFFECTING_ACTIONS.has(actionType)) return false
  // For custom_webhook: only wrap non-GET requests
  if (actionType === 'custom_webhook') {
    const cfg = toolConfig as Record<string, unknown> | null | undefined
    const method = ((cfg?.method as string | undefined) ?? 'POST').toUpperCase()
    return method !== 'GET'
  }
  return true
}

// ---------------------------------------------------------------------------
// IDEMP-02: Check for existing cached response
// ---------------------------------------------------------------------------

export async function checkIdempotency(
  organizationId: string,
  idempotencyKey: string
): Promise<string | null> {
  const supabase = createServiceRoleClient()

  const { data } = await supabase
    .from('tool_idempotency_keys')
    .select('response')
    .eq('organization_id', organizationId)
    .eq('idempotency_key', idempotencyKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!data) return null

  // response is JSONB | if it's a string, return it directly; if object, JSON.stringify
  const response = data.response
  if (typeof response === 'string') return response
  return JSON.stringify(response)
}

// ---------------------------------------------------------------------------
// IDEMP-02: Persist response after successful execution
// ---------------------------------------------------------------------------

export async function recordIdempotency(params: {
  organizationId: string
  agentInvocationId: string
  idempotencyKey: string
  toolName: string
  requestHash: string
  response: string
}): Promise<void> {
  const supabase = createServiceRoleClient()

  const { error } = await supabase
    .from('tool_idempotency_keys')
    .upsert(
      {
        organization_id: params.organizationId,
        agent_invocation_id: params.agentInvocationId,
        idempotency_key: params.idempotencyKey,
        tool_name: params.toolName,
        request_hash: params.requestHash,
        response: params.response,
        // expires_at defaults to now() + 24h in the DB
      },
      { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true }
    )

  if (error) {
    // Non-fatal | log and continue; the tool already executed
    createLogger({ toolName: params.toolName })
      .warn('idempotency_record_failed', { idempotencyKey: params.idempotencyKey, error: error.message })
  }
}

// ---------------------------------------------------------------------------
// Request hash | stable fingerprint of tool args for debugging
// ---------------------------------------------------------------------------

export function hashToolArgs(toolArgs: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(toolArgs)).digest('hex')
}
