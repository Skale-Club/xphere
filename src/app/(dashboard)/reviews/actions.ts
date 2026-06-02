'use server'

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
}

export async function saveWidgetSettings(profileId: string, settings: SavedWidgetSettings): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('google_business_profiles')
    .update({ widget_settings: settings as never })
    .eq('id', profileId)
}
