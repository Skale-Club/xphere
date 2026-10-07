// Membership validation for MCP per-user multi-org access.
//
// The MCP server uses the service-role client (bypasses RLS) so org safety
// CANNOT rely on RLS — this in-code check is the only guard preventing a
// user from acting on an org they don't belong to.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpAuthContext } from './auth'
import type { McpToolError } from './tool-types'

/**
 * Returns true only when a (userId, orgId) row exists in org_members.
 * Uses the service-role client because the caller context has no auth.uid().
 */
export async function assertUserInOrg(userId: string, orgId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data } = await supabase
    .from('org_members')
    .select('id')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return data !== null
}

export interface OrgResolutionResult {
  effectiveAuth: McpAuthContext
  denial?: McpToolError
}

/**
 * Resolves the effective org for a per-call org_id parameter.
 *
 * Rules:
 * - No org_id supplied: use auth.orgId unchanged.
 * - Legacy xph_ token: it is bound to one org, so an org_id naming that org
 *   passes and any other org_id is denied. Silently falling back to the
 *   token's org used to answer the caller with another tenant's data.
 * - OAuth + org_id: validate membership; deny if not a member.
 * - Each call gets an independent McpAuthContext — auth is never mutated.
 */
export async function resolveEffectiveOrg(
  auth: McpAuthContext,
  requestedOrgId: string | undefined,
): Promise<OrgResolutionResult> {
  if (!requestedOrgId) {
    return { effectiveAuth: auth }
  }
  if (auth.kind !== 'oauth' || !auth.userId) {
    if (requestedOrgId === auth.orgId) return { effectiveAuth: auth }
    return {
      effectiveAuth: auth,
      denial: {
        error: 'org_mismatch',
        detail: `This token is bound to organization ${auth.orgId} and cannot act on ${requestedOrgId}. Use a token generated in that organization (Settings → MCP Server) or connect via OAuth to switch orgs per call.`,
        status: 403,
      },
    }
  }
  const isMember = await assertUserInOrg(auth.userId, requestedOrgId)
  if (!isMember) {
    return {
      effectiveAuth: auth,
      denial: { error: 'not_member', detail: 'User is not a member of the requested organization', status: 403 },
    }
  }
  return { effectiveAuth: { ...auth, orgId: requestedOrgId } }
}
