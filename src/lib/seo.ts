import { unstable_cache } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'

export const getFaviconUrl = unstable_cache(
  async (): Promise<string | null> => {
    try {
      const admin = createServiceRoleClient()
      const { data } = await admin
        .from('seo_config')
        .select('favicon_url')
        .limit(1)
        .single()
      return (data as { favicon_url?: string | null } | null)?.favicon_url ?? null
    } catch {
      return null
    }
  },
  ['seo-favicon'],
  { revalidate: 3600 }
)
