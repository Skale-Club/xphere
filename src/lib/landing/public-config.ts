import { createServiceRoleClient } from '@/lib/supabase/admin'

import { DEFAULT_CTA_IMAGE_URL } from './default-cta-image'

export { DEFAULT_CTA_IMAGE_URL }

export async function getLandingPublicConfig(): Promise<{
  ctaImageUrl: string
  scrollImages: string[]
}> {
  try {
    const admin = createServiceRoleClient()
    const { data } = await admin
      .from('landing_config')
      .select('cta_image_url, scroll_images')
      .limit(1)
      .single()
    return {
      ctaImageUrl: data?.cta_image_url || DEFAULT_CTA_IMAGE_URL,
      scrollImages: data?.scroll_images ?? [],
    }
  } catch {
    return { ctaImageUrl: DEFAULT_CTA_IMAGE_URL, scrollImages: [] }
  }
}
