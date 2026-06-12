// src/lib/calls/routing-chain.ts
// Resolution + rendering for org-level call routing chains.
//
// A chain is an ordered list of stages; each stage rings 1+ targets in parallel
// (simultaneous ring, first to answer wins). When a stage isn't answered within
// its timeout, the Twilio <Dial action> callback (/api/twilio/voice/continue)
// advances to the next ENABLED, resolvable stage. The terminal fall-through is a
// voicemail/hangup.
//
// `browser` and `pwa` targets both resolve to the user's Twilio Voice SDK client
// identity (call_settings.twilio_client_identity); `pwa` additionally returns the
// user_id so the caller can fire a web-push to wake a backgrounded PWA. `cell`
// and `forward` are raw PSTN numbers; `sip` resolves to a SIP URI.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { twimlDialStage, type TwimlContext } from '@/lib/calls/twiml-builder'
import { insertNotification } from '@/lib/notifications/insert'
import type { CallRoutingStage } from '@/types/database'

/**
 * Wake the targeted users' PWAs via web-push for a ringing stage. Fire-and-watch
 * — the actual push fan-out is non-blocking inside insertNotification. The PWA
 * service worker renders this as a ringing notification (see public/sw.js).
 */
export async function fireIncomingCallPush(
  orgId: string,
  userIds: string[],
  payload: { caller_number?: string; caller_name?: string; call_id?: string },
): Promise<void> {
  if (userIds.length === 0) return
  await insertNotification(orgId, 'incoming_call', payload, userIds)
}

export interface ResolvedStageNouns {
  clients: string[]
  numbers: string[]
  sips: string[]
  /** user_ids of `pwa` targets to wake via web-push. */
  pwaUserIds: string[]
}

function hasNouns(n: ResolvedStageNouns): boolean {
  return n.clients.length > 0 || n.numbers.length > 0 || n.sips.length > 0
}

/**
 * Load the active routing chain for an org, keeping only enabled stages that
 * have at least one target. Returns null when no active chain is configured |
 * the caller then falls back to the legacy single-mode resolver.
 */
export async function getRoutingChainForOrg(
  orgId: string,
): Promise<CallRoutingStage[] | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('call_routing_chains')
    .select('is_active, stages')
    .eq('org_id', orgId)
    .maybeSingle()

  if (!data || !data.is_active) return null

  const stages = (Array.isArray(data.stages) ? data.stages : [])
    .filter(
      (s): s is CallRoutingStage =>
        !!s &&
        s.enabled === true &&
        Array.isArray(s.targets) &&
        s.targets.length > 0,
    )

  return stages.length > 0 ? stages : null
}

async function getSipDomainForOrg(orgId: string): Promise<string | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('integrations')
    .select('config')
    .eq('organization_id', orgId)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return (data?.config as { sip_domain?: string } | null)?.sip_domain ?? null
}

/** Org-level record-calls default (first call_settings row). Defaults to true. */
export async function getRecordCallsForOrg(orgId: string): Promise<boolean> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('call_settings')
    .select('record_calls')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.record_calls ?? true
}

/** Resolve a stage's abstract targets into concrete TwiML nouns. */
export async function resolveStageNouns(
  orgId: string,
  stage: CallRoutingStage,
): Promise<ResolvedStageNouns> {
  const supabase = createServiceRoleClient()
  const clients: string[] = []
  const numbers: string[] = []
  const sips: string[] = []
  const pwaUserIds: string[] = []

  const userIds = stage.targets
    .filter((t) => (t.type === 'browser' || t.type === 'pwa' || t.type === 'sip') && t.user_id)
    .map((t) => t.user_id as string)

  const settingsByUser = new Map<string, { identity: string | null; sip: string | null }>()
  if (userIds.length > 0) {
    const { data } = await supabase
      .from('call_settings')
      .select('user_id, twilio_client_identity, sip_username')
      .eq('org_id', orgId)
      .in('user_id', userIds)
    for (const r of data ?? []) {
      settingsByUser.set(r.user_id, { identity: r.twilio_client_identity, sip: r.sip_username })
    }
  }

  let sipDomain: string | null = null
  if (stage.targets.some((t) => t.type === 'sip')) {
    sipDomain = await getSipDomainForOrg(orgId)
  }

  for (const t of stage.targets) {
    if (t.type === 'browser' || t.type === 'pwa') {
      const identity = t.user_id ? settingsByUser.get(t.user_id)?.identity : null
      if (identity) clients.push(identity)
      if (t.type === 'pwa' && t.user_id) pwaUserIds.push(t.user_id)
    } else if (t.type === 'cell' || t.type === 'forward') {
      if (t.number) numbers.push(t.number)
    } else if (t.type === 'sip') {
      const su = t.user_id ? settingsByUser.get(t.user_id)?.sip : null
      if (su && sipDomain) sips.push(`sip:${su}@${sipDomain}`)
    }
  }

  return {
    clients: [...new Set(clients)],
    numbers: [...new Set(numbers)],
    sips: [...new Set(sips)],
    pwaUserIds: [...new Set(pwaUserIds)],
  }
}

export interface StageRenderResult {
  twiml: string
  /** user_ids whose PWA should be woken via web-push for this ringing stage. */
  pwaUserIds: string[]
}

/**
 * Render the first ENABLED, resolvable stage at or after `startIndex`. The
 * <Dial action> points back at the continue endpoint with the NEXT index, so
 * an unanswered stage advances the chain. Returns null when no further stage
 * resolves (caller renders voicemail/hangup).
 */
export async function renderChainStage(args: {
  orgId: string
  stages: CallRoutingStage[]
  startIndex: number
  ctx: TwimlContext
}): Promise<StageRenderResult | null> {
  const { orgId, stages, startIndex, ctx } = args

  for (let i = startIndex; i < stages.length; i++) {
    const nouns = await resolveStageNouns(orgId, stages[i])
    if (!hasNouns(nouns)) continue

    const base = ctx.baseUrl.replace(/\/$/, '')
    const actionUrl = `${base}/api/twilio/voice/continue?org=${encodeURIComponent(orgId)}&stage=${i + 1}`
    const twiml = twimlDialStage(nouns, ctx, {
      timeoutSeconds: stages[i].timeout_seconds || 30,
      actionUrl,
    })
    return { twiml, pwaUserIds: nouns.pwaUserIds }
  }

  return null
}
