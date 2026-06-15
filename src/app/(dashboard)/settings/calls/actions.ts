'use server'

/**
 * Server actions for the org-level call routing chain (simultaneous-ring +
 * ordered fallback). One chain per org (call_routing_chains.org_id is UNIQUE).
 *
 * Reads/writes the chain row through the authenticated client (RLS scopes it to
 * the active org). Auto-provisions a Twilio client identity for any user added
 * as a browser/pwa target so their Voice SDK Device can actually receive the
 * <Client> leg — done via the service-role client after confirming membership.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { generateClientIdentity } from '@/lib/calls/zod-schemas'
import type { CallRoutingStage } from '@/types/database'

const E164_REGEX = /^\+[1-9]\d{6,14}$/

const TargetSchema = z
  .object({
    type: z.enum(['browser', 'pwa', 'cell', 'sip', 'forward', 'team']),
    user_id: z.string().uuid().optional(),
    number: z.string().regex(E164_REGEX, 'Number must be in E.164 format, e.g. +14155551234.').optional(),
  })
  .superRefine((t, ctx) => {
    if ((t.type === 'browser' || t.type === 'pwa' || t.type === 'sip') && !t.user_id) {
      ctx.addIssue({ code: 'custom', message: 'Select the user for this destination.', path: ['user_id'] })
    }
    if ((t.type === 'cell' || t.type === 'forward') && !t.number) {
      ctx.addIssue({ code: 'custom', message: 'Enter the destination number.', path: ['number'] })
    }
  })

const StageSchema = z.object({
  enabled: z.boolean(),
  timeout_seconds: z.number().int().min(5).max(120),
  targets: z.array(TargetSchema).min(1, 'Each stage needs at least one destination.'),
})

const ChainSchema = z.object({
  is_active: z.boolean(),
  stages: z.array(StageSchema).max(10, 'Maximum of 10 stages.'),
})

export type RoutingChainInput = z.input<typeof ChainSchema>

export interface RoutingChainState {
  is_active: boolean
  stages: CallRoutingStage[]
}

export async function getRoutingChain(): Promise<RoutingChainState> {
  const user = await getUser()
  if (!user) return { is_active: true, stages: [] }
  const supabase = await createClient()

  const { data } = await supabase
    .from('call_routing_chains')
    .select('is_active, stages')
    .maybeSingle()

  if (!data) return { is_active: true, stages: [] }
  return {
    is_active: data.is_active,
    stages: Array.isArray(data.stages) ? data.stages : [],
  }
}

/**
 * Ensure each referenced user has a Twilio client identity. Only members of the
 * org are provisioned. Uses the service-role client because identities live on
 * other users' call_settings rows (RLS would block cross-user writes).
 */
async function ensureClientIdentities(orgId: string, userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (unique.length === 0) return

  const admin = createServiceRoleClient()

  // Confirm membership before touching anyone's settings.
  const { data: members } = await admin
    .from('org_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .in('user_id', unique)
  const memberIds = new Set((members ?? []).map((m) => m.user_id))
  const targets = unique.filter((id) => memberIds.has(id))
  if (targets.length === 0) return

  const { data: rows } = await admin
    .from('call_settings')
    .select('id, user_id, twilio_client_identity')
    .eq('org_id', orgId)
    .in('user_id', targets)
  const byUser = new Map((rows ?? []).map((r) => [r.user_id, r]))

  for (const uid of targets) {
    const row = byUser.get(uid)
    if (row?.twilio_client_identity) continue
    const identity = generateClientIdentity(uid)
    if (row) {
      await admin.from('call_settings').update({ twilio_client_identity: identity }).eq('id', row.id)
    } else {
      await admin.from('call_settings').insert({
        org_id: orgId,
        user_id: uid,
        routing_mode: 'browser',
        twilio_client_identity: identity,
      })
    }
  }
}

export async function saveRoutingChain(
  input: RoutingChainInput,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const parsed = ChainSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid routing configuration.' }
  }
  const chain = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  // Auto-provision Voice SDK identities so each target's Device can receive its
  // leg. For a `team` target that means every org member (so "ring all users"
  // actually rings everyone); otherwise just the named browser/pwa users.
  const voiceUserIds = chain.stages.flatMap((s) =>
    s.targets
      .filter((t) => (t.type === 'browser' || t.type === 'pwa') && t.user_id)
      .map((t) => t.user_id as string),
  )
  const hasTeamTarget = chain.stages.some((s) => s.targets.some((t) => t.type === 'team'))
  if (hasTeamTarget) {
    const { data: members } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('organization_id', orgId as string)
    voiceUserIds.push(...(members ?? []).map((m) => m.user_id))
  }
  await ensureClientIdentities(orgId as string, voiceUserIds)

  const { error } = await supabase
    .from('call_routing_chains')
    .upsert(
      {
        org_id: orgId as string,
        is_active: chain.is_active,
        stages: chain.stages as CallRoutingStage[],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id' },
    )

  if (error) return { error: error.message }

  revalidatePath('/calls/routing')
  revalidatePath('/settings/calls')
  return {}
}
