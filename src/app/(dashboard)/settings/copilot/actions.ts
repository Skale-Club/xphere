'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function setCopilotEnabled(enabled: boolean): Promise<void> {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) throw new Error('No active organization')

  // Read current JSONB settings, merge the new flag, write back.
  const { data: org } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', orgId as string)
    .maybeSingle()

  const current = (org?.settings ?? {}) as Record<string, unknown>
  const updated = { ...current, copilot_enabled: enabled }

  const { error } = await supabase
    .from('organizations')
    .update({ settings: updated })
    .eq('id', orgId as string)

  if (error) throw new Error(error.message)

  revalidatePath('/settings/copilot')
  revalidatePath('/', 'layout')
}
