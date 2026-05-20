'use server'

import { revalidatePath, revalidateTag } from 'next/cache'

// Next.js 16 requires a cache profile as the second arg to revalidateTag.
const REVALIDATE_PROFILE = 'max'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export type SeoConfig = {
  id: string
  site_title: string
  title_template: string
  description: string
  og_image_url: string | null
  favicon_url: string | null
  keywords: string[]
  updated_at: string
}

export async function getSeoConfig(): Promise<SeoConfig> {
  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('seo_config')
    .select('*')
    .limit(1)
    .single()

  if (error) throw new Error(`Failed to load SEO config: ${error.message}`)
  return data as SeoConfig
}

export async function updateFaviconUrl(id: string, favicon_url: string | null): Promise<void> {
  const admin = createServiceRoleClient()
  const { error } = await admin
    .from('seo_config')
    .update({ favicon_url, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Failed to update favicon: ${error.message}`)
  revalidateTag('seo-favicon', REVALIDATE_PROFILE)
  revalidatePath('/', 'layout')
}

export async function updateSeoConfig(
  id: string,
  values: {
    site_title: string
    title_template: string
    description: string
    og_image_url: string | null
    favicon_url: string | null
    keywords: string[]
  }
): Promise<void> {
  const admin = createServiceRoleClient()
  const { error } = await admin
    .from('seo_config')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(`Failed to update SEO config: ${error.message}`)
  revalidateTag('seo-favicon', REVALIDATE_PROFILE)
  revalidatePath('/', 'layout')
}
