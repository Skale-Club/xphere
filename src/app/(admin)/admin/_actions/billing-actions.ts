'use server'

// Agency (platform-admin) billing controls for the hybrid sales model: manually
// assign a plan, grant Copilot credits, or extend a trial for any org — bypassing
// Stripe. Mirrors the admin action pattern (assert platform admin → service-role
// write → revalidate). Writes go through the same trusted boundary as the rest of
// the admin surface.
import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getPlan } from '@/lib/billing/catalog'
import { grantCopilot } from '@/lib/billing/credits'

async function assertPlatformAdmin() {
  const user = await getUser()
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL
  if (!user || !adminEmail || user.email !== adminEmail) {
    throw new Error('Unauthorized')
  }
  return user
}

type Result = { ok: true } | { ok: false; error: string }

/** Assign (or clear, with null) a manual plan override that bypasses Stripe. */
export async function setOrgPlanOverride(orgId: string, planKey: string | null): Promise<Result> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }
  if (planKey !== null && !getPlan(planKey)) return { ok: false, error: 'Unknown plan.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any
  const { error } = await admin.from('organizations').update({ plan_override: planKey }).eq('id', orgId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/orgs/${orgId}`)
  return { ok: true }
}

/** Grant Copilot credits (USD) into an org's persistent top-up bucket. */
export async function grantCopilotCredits(orgId: string, amountUsd: number): Promise<Result> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }
  if (!(amountUsd > 0)) return { ok: false, error: 'Amount must be greater than 0.' }
  try {
    await grantCopilot(orgId, amountUsd, 'grant', null, 'Granted by platform admin')
    revalidatePath(`/admin/orgs/${orgId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to grant credits.' }
  }
}

/**
 * Extend an org's trial by `days` from the later of now / current end. Negative
 * days shorten it. Use to give a customer more runway before enforcement bites.
 */
export async function extendTrial(orgId: string, days: number): Promise<Result> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }
  if (!Number.isFinite(days) || days === 0) {
    return { ok: false, error: 'Provide a non-zero number of days.' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any
  const { data: org, error: readErr } = await admin
    .from('organizations')
    .select('trial_ends_at')
    .eq('id', orgId)
    .single()
  if (readErr) return { ok: false, error: readErr.message }

  const current = org?.trial_ends_at ? new Date(org.trial_ends_at) : null
  const base = current && current.getTime() > Date.now() ? current : new Date()
  base.setDate(base.getDate() + days)

  const { error } = await admin
    .from('organizations')
    .update({ trial_ends_at: base.toISOString() })
    .eq('id', orgId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/orgs/${orgId}`)
  return { ok: true }
}
