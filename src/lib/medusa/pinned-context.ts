// src/lib/medusa/pinned-context.ts
// One `conversations` lookup that yields BOTH the R6 rate-limit session key
// (session_key, falling back to conversationId) and the pinned commerce
// context (memory.commerce — cart id, region id, country code, etc). See
// 132-RESEARCH.md "Session key & pinning — the single-lookup insight".

import type { MedusaExecCtx } from './client'

export interface PinnedContext {
  sessionKey: string
  commerce: Record<string, unknown>
}

export async function loadPinnedContext(ctx: MedusaExecCtx): Promise<PinnedContext> {
  if (!ctx.conversationId) return { sessionKey: ctx.organizationId, commerce: {} }
  const { data } = await ctx.supabase
    .from('conversations')
    .select('session_key, memory')
    .eq('id', ctx.conversationId)
    .eq('org_id', ctx.organizationId)
    .maybeSingle()
  const sessionKey = (data?.session_key as string | null) ?? ctx.conversationId
  const commerce = ((data?.memory as Record<string, unknown> | undefined)?.commerce ?? {}) as Record<
    string,
    unknown
  >
  return { sessionKey, commerce }
}
