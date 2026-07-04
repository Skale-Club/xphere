'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { PlatformTrackingConfigRow } from '@/types/database'

// Next.js 16 requires a cache profile as the second arg to revalidateTag.
const REVALIDATE_PROFILE = 'max'

async function assertPlatformAdmin() {
  const user = await getUser()
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL
  if (!user || !adminEmail || user.email !== adminEmail) {
    throw new Error('Unauthorized')
  }
  return user
}

// ─── Getter ───────────────────────────────────────────────────────────────

export async function getPlatformTrackingConfig(): Promise<{
  settings: PlatformTrackingConfigRow | null
  error?: string
}> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { settings: null, error: 'Unauthorized' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data } = await supabase
    .from('platform_tracking_config')
    .select('id, gtm_container_id, facebook_pixel_id, is_active, created_at, updated_at')
    .single()

  return { settings: (data as PlatformTrackingConfigRow | null) ?? null }
}

// ─── Save ─────────────────────────────────────────────────────────────────

export async function savePlatformTrackingConfig(input: {
  gtmContainerId: string | null
  facebookPixelId: string | null
  isActive: boolean
}): Promise<{ error?: string }> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { error: 'Unauthorized' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any

  const { data: existing } = await supabase
    .from('platform_tracking_config')
    .select('id')
    .single()

  const basePayload = {
    gtm_container_id: input.gtmContainerId || null,
    facebook_pixel_id: input.facebookPixelId || null,
    is_active: input.isActive,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error } = await supabase
      .from('platform_tracking_config')
      .update(basePayload)
      .eq('id', existing.id)

    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('platform_tracking_config').insert(basePayload)
    if (error) return { error: error.message }
  }

  // revalidatePath refreshes the admin form and the root layout (where the
  // scripts render); revalidateTag busts the cached getTrackingConfig() so
  // the live scripts update without waiting for the 1hr revalidate window.
  revalidatePath('/admin/tracking')
  revalidatePath('/', 'layout')
  revalidateTag('platform-tracking-config', REVALIDATE_PROFILE)
  return {}
}
