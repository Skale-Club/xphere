import 'server-only'

import { cookies } from 'next/headers'

import { createClient } from '@/lib/supabase/server'
import {
  DASHBOARD_TOUR_COOKIE,
  DASHBOARD_TOUR_KEY,
} from '@/lib/onboarding/constants'

export type TourCompletionLookup = (
  userId: string,
  tourKey: string,
) => Promise<string | null>

export async function shouldShowDashboardTour(
  userId: string,
  lookupCompletion: TourCompletionLookup,
): Promise<boolean> {
  try {
    const completedAt = await lookupCompletion(userId, DASHBOARD_TOUR_KEY)
    return completedAt === null
  } catch {
    return false
  }
}

export async function loadDashboardTourEligibility(userId: string): Promise<boolean> {
  const cookieStore = await cookies()
  if (cookieStore.get(DASHBOARD_TOUR_COOKIE)?.value === '1') return false

  return shouldShowDashboardTour(userId, async (lookupUserId, tourKey) => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('user_tour_progress')
      .select('completed_at')
      .eq('user_id', lookupUserId)
      .eq('tour_key', tourKey)
      .maybeSingle()

    if (error) {
      console.error('[onboarding] Failed to load tour progress:', error.message)
      throw error
    }

    return data?.completed_at ?? null
  })
}
