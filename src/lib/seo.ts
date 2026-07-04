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
  { revalidate: 3600, tags: ['seo-favicon'] }
)

export interface SeoMetadataConfig {
  siteTitle: string
  titleTemplate: string
  description: string
  keywords: string[]
  ogImageUrl: string | null
}

/** Admin-configured metadata (title/description/keywords/OG image) for public pages. */
export const getSeoMetadataConfig = unstable_cache(
  async (): Promise<SeoMetadataConfig | null> => {
    try {
      const admin = createServiceRoleClient()
      const { data } = await admin
        .from('seo_config')
        .select('site_title, title_template, description, keywords, og_image_url')
        .limit(1)
        .single()
      if (!data) return null
      const row = data as {
        site_title: string
        title_template: string
        description: string
        keywords: string[] | null
        og_image_url: string | null
      }
      return {
        siteTitle: row.site_title,
        titleTemplate: row.title_template,
        description: row.description,
        keywords: row.keywords ?? [],
        ogImageUrl: row.og_image_url,
      }
    } catch {
      return null
    }
  },
  ['seo-metadata-config'],
  { revalidate: 3600, tags: ['seo-metadata-config'] }
)
