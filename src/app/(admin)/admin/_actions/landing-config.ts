'use server'

import { revalidatePath } from 'next/cache'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/supabase/server'
import * as storage from '@/lib/storage'
import { SCROLL_IMAGES_LIMIT } from './landing-config-constants'


export type LandingConfig = {
  id: string
  cta_image_url: string | null
  scroll_images: string[]
  updated_at: string
}

async function assertAdmin() {
  const user = await getUser()
  if (!user || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    throw new Error('Unauthorized')
  }
}

export async function getLandingConfig(): Promise<LandingConfig> {
  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('landing_config')
    .select('*')
    .limit(1)
    .single()

  if (error) throw new Error(`Failed to load landing config: ${error.message}`)
  return data as LandingConfig
}

export async function updateCtaImage(id: string, cta_image_url: string | null): Promise<void> {
  await assertAdmin()
  const admin = createServiceRoleClient()
  const { error } = await admin
    .from('landing_config')
    .update({ cta_image_url, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Failed to update CTA image: ${error.message}`)
  revalidatePath('/', 'layout')
}

export async function setScrollImages(id: string, scroll_images: string[]): Promise<void> {
  await assertAdmin()
  const admin = createServiceRoleClient()
  const { error } = await admin
    .from('landing_config')
    .update({ scroll_images, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Failed to update scroll images: ${error.message}`)
  revalidatePath('/', 'layout')
}

export async function appendScrollImage(id: string, url: string): Promise<string[]> {
  await assertAdmin()
  const admin = createServiceRoleClient()
  const current = await getLandingConfig()
  if (current.scroll_images.length >= SCROLL_IMAGES_LIMIT) {
    throw new Error(`Limit of ${SCROLL_IMAGES_LIMIT} scroll images reached.`)
  }
  const next = [...current.scroll_images, url]
  const { error } = await admin
    .from('landing_config')
    .update({ scroll_images: next, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Failed to append scroll image: ${error.message}`)
  revalidatePath('/', 'layout')
  return next
}

export async function clearScrollImages(id: string): Promise<void> {
  await assertAdmin()
  const admin = createServiceRoleClient()

  const current = await getLandingConfig()
  const storagePaths = current.scroll_images
    // Path inside the branding bucket, from either a Supabase or an R2 public URL (?v= stripped)
    .map(url => storage.pathFromPublicUrl('branding', url))
    .filter(Boolean) as string[]

  if (storagePaths.length > 0) {
    await storage.remove('branding', storagePaths, { client: admin })
  }

  const { error } = await admin
    .from('landing_config')
    .update({ scroll_images: [], updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Failed to clear scroll images: ${error.message}`)
  revalidatePath('/', 'layout')
}
