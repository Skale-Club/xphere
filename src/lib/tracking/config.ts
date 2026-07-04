import { unstable_cache } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'

export interface TrackingConfig {
  gtmContainerId: string | null
  facebookPixelId: string | null
}

export const getTrackingConfig = unstable_cache(
  async (): Promise<TrackingConfig | null> => {
    try {
      const admin = createServiceRoleClient()
      const { data } = await admin
        .from('platform_tracking_config')
        .select('gtm_container_id, facebook_pixel_id, is_active')
        .limit(1)
        .single()

      const row = data as { gtm_container_id: string | null; facebook_pixel_id: string | null; is_active: boolean } | null
      if (!row?.is_active) return null

      return { gtmContainerId: row.gtm_container_id, facebookPixelId: row.facebook_pixel_id }
    } catch {
      return null
    }
  },
  ['platform-tracking-config'],
  { revalidate: 3600, tags: ['platform-tracking-config'] }
)
