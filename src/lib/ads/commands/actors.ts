// Resolve "who is asking" for each entry point into the command engine.
// The engine itself never reads a session — it trusts the actor it is given —
// so these helpers are the single place where RBAC is translated for it.

import type { McpAuthContext } from '@/lib/mcp/auth'
import { can } from '@/lib/rbac/server'
import { getUser } from '@/lib/supabase/server'
import type { AdsActor } from './types'

/** The signed-in dashboard user, or null when there is no session. */
export async function dashboardActor(): Promise<AdsActor | null> {
  const user = await getUser()
  if (!user) return null
  const [canManage, canApprove] = await Promise.all([can('ads.manage'), can('ads.approve')])
  return {
    type: 'user',
    id: user.id,
    label: `user:${user.email ?? user.id}`,
    canManage,
    canApprove,
  }
}

/**
 * An MCP client (Codex, Claude, any agent). Always a machine actor: what it may
 * do is decided by the account's ai_mode policy, never by the permissions of
 * the human who issued the token.
 */
export function mcpActor(auth: McpAuthContext): AdsActor {
  return {
    type: 'ai',
    id: auth.userId,
    label: auth.actor,
    canManage: false,
    canApprove: false,
  }
}

/** The in-app Copilot, acting for the signed-in user. */
export function copilotActor(userId: string | null): AdsActor {
  return {
    type: 'ai',
    id: userId,
    label: `copilot:${userId ?? 'unknown'}`,
    canManage: false,
    canApprove: false,
  }
}
