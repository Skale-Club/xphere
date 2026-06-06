'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type SavedWidgetSettings = {
  layout?: string
  theme?: string
  minRating?: string
  limit?: string
  showHero?: boolean
  equalHeight?: boolean
  footerCta?: boolean
  embedMode?: string
  maxChars?: string
  showOwnerResponse?: boolean
}

export async function saveWidgetSettings(profileId: string, settings: SavedWidgetSettings): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('google_business_profiles')
    .update({ widget_settings: settings as never })
    .eq('id', profileId)
  if (error) throw new Error(error.message)
  revalidatePath('/reviews')
}
