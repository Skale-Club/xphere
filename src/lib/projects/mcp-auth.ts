import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

export interface McpAuthResult {
  orgId: string
  actor: string
}

export async function validateMcpToken(authHeader: string | null): Promise<McpAuthResult | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const provided = authHeader.slice(7).trim()
  if (!provided.startsWith('xph_') || provided.length < 16) return null

  const prefix = provided.slice(0, 12)
  const supabase = createServiceRoleClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('project_mcp_tokens')
    .select('org_id, token_hash, token_prefix')
    .eq('token_prefix', prefix)
    .eq('active', true)
    .maybeSingle()

  if (!data) return null

  try {
    const stored = await decrypt(data.token_hash as string)
    if (stored !== provided) return null
    return { orgId: data.org_id as string, actor: `mcp:${prefix}` }
  } catch {
    return null
  }
}

export async function writeAuditLog(
  orgId: string,
  actor: string,
  action: string,
  target: string | null,
  status: 'success' | 'failed' | 'blocked',
  notes?: string,
): Promise<void> {
  const supabase = createServiceRoleClient()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('project_mcp_audit_logs').insert({
      org_id: orgId,
      area: 'projects',
      actor_type: 'ai_agent',
      actor,
      action,
      target,
      status,
      notes: notes ?? null,
    })
  } catch {
    // Audit log failure must never break the main response
  }
}
