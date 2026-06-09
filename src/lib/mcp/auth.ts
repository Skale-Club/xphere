// Unified MCP bearer auth | accepts either:
//   1. Legacy xph_-prefixed token from project_mcp_tokens (encrypted/symmetric)
//   2. OAuth access token issued through /api/mcp/oauth/* (SHA-256 hashed)
//
// Both flows resolve to the same shape: { orgId, userId?, actor, scope, kind }.
// Audit logging is the same too | actions go into project_mcp_audit_logs with
// area='general_xphere'|'projects'|'oauth' depending on the caller.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { sha256Hex } from '@/lib/mcp/crypto'

export type McpAuthKind = 'legacy_token' | 'oauth'

export interface McpAuthContext {
  kind: McpAuthKind
  orgId: string
  userId: string | null   // only set when kind === 'oauth'
  actor: string           // identifier for audit logs (e.g. "mcp:xph_abc1" or "oauth:client_abc:user_uuid")
  scope: string           // 'mcp:all' for legacy, scope from oauth_tokens otherwise
}

/**
 * Parses an Authorization header and resolves it to an MCP auth context.
 * Returns null when no recognized credential is present (caller must 401).
 */
export async function authenticateMcpRequest(
  authHeader: string | null,
): Promise<McpAuthContext | null> {
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null

  // Legacy: token issued by project_mcp_tokens (Settings page rotate flow).
  if (token.startsWith('xph_')) {
    return await resolveLegacyToken(token)
  }

  // OAuth: token issued by /api/mcp/oauth/token | opaque, sha256-hashed at rest.
  return await resolveOAuthToken(token)
}

async function resolveLegacyToken(token: string): Promise<McpAuthContext | null> {
  if (token.length < 16) return null
  const prefix = token.slice(0, 12)
  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('project_mcp_tokens')
    .select('org_id, user_id, token_hash')
    .eq('token_prefix', prefix)
    .eq('active', true)
    .maybeSingle()
  if (!data) return null
  try {
    const stored = await decrypt(data.token_hash as string)
    if (stored !== token) return null
  } catch {
    return null
  }
  return {
    kind: 'legacy_token',
    orgId: data.org_id as string,
    userId: data.user_id as string,
    actor: `mcp:${prefix}`,
    scope: 'mcp:all',
  }
}

async function resolveOAuthToken(token: string): Promise<McpAuthContext | null> {
  const hash = await sha256Hex(token)
  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('mcp_oauth_tokens')
    .select('org_id, user_id, client_id, scope, expires_at, revoked')
    .eq('access_token_hash', hash)
    .maybeSingle()
  if (!data || data.revoked) return null
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null

  // Best-effort last_used_at touch | failure is non-fatal.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(supabase as any)
    .from('mcp_oauth_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('access_token_hash', hash)
    .then(() => undefined, () => undefined)

  return {
    kind: 'oauth',
    orgId: data.org_id as string,
    userId: data.user_id as string,
    actor: `oauth:${data.client_id}:${(data.user_id as string).slice(0, 8)}`,
    scope: (data.scope as string) ?? 'mcp:all',
  }
}

export interface AuditLogInput {
  orgId: string
  actor: string
  area?: 'general_xphere' | 'projects' | 'oauth'
  action: string
  target?: string | null
  status?: 'success' | 'failed' | 'blocked'
  notes?: string
}

/**
 * Writes an MCP action to the audit log. Never throws | a logging failure
 * must not break the actual MCP response path.
 */
export async function writeMcpAuditLog(input: AuditLogInput): Promise<void> {
  const supabase = createServiceRoleClient()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('project_mcp_audit_logs').insert({
      org_id: input.orgId,
      area: input.area ?? 'general_xphere',
      actor_type: 'ai_agent',
      actor: input.actor,
      action: input.action,
      target: input.target ?? null,
      status: input.status ?? 'success',
      notes: input.notes ?? null,
    })
  } catch {
    // intentional: audit log must never block product flow
  }
}
