'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCopilotModelTier, type CopilotModelTier } from '@/lib/copilot/resolve-provider'
import type { Json } from '@/types/database'

async function mergeOrgSettings(patch: Record<string, unknown>): Promise<void> {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) throw new Error('No active organization')

  // Read current JSONB settings, merge the patch, write back.
  const { data: org } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', orgId as string)
    .maybeSingle()

  const current = (org?.settings ?? {}) as Record<string, unknown>
  const updated = { ...current, ...patch }

  const { error } = await supabase
    .from('organizations')
    .update({ settings: updated as unknown as Json })
    .eq('id', orgId as string)

  if (error) throw new Error(error.message)

  revalidatePath('/settings/copilot')
  revalidatePath('/', 'layout')
}

export async function setCopilotEnabled(enabled: boolean): Promise<void> {
  await mergeOrgSettings({ copilot_enabled: enabled })
}

export async function setCopilotModelTier(tier: CopilotModelTier): Promise<void> {
  if (!isCopilotModelTier(tier)) throw new Error('Invalid model tier')
  await mergeOrgSettings({ copilot_model_tier: tier })
}
