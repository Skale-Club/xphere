'use server'

import { DASHBOARD_TOUR_KEY } from '@/lib/onboarding/constants'
import { createClient, getUser } from '@/lib/supabase/server'

export async function completeDashboardTour(): Promise<void> {
  const user = await getUser()
  if (!user) return

  const supabase = await createClient()
  const { error } = await supabase
    .from('user_tour_progress')
    .upsert(
      {
        user_id: user.id,
        tour_key: DASHBOARD_TOUR_KEY,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,tour_key' },
    )

  if (error) {
    console.error('[onboarding] Failed to persist tour completion:', error.message)
  }
}
