'use server'

// Super-admin global game analytics (BS-ANALYTICS-001). Cross-organization by
// design: these actions use the service-role client, so every one of them checks
// the platform admin itself before creating it (the admin layout gate does not
// protect a server action that is called directly). Nothing here is player
// facing and nothing is public.

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  loadGameAdminData,
  loadGameAdminOptions,
  loadGamePickSegments,
  parseGameAdminInput,
  parseGameRange,
  type GameAdminData,
  type GameAdminInput,
  type GameAdminOptions,
  type GamePickSegment,
  type GameSegmentBy,
} from '@/lib/analytics/game-panels'
import type { GameStatsClient } from '@/lib/analytics/game-queries'

const SEGMENTS: readonly GameSegmentBy[] = ['period', 'device', 'guest', 'source']

async function requirePlatformAdmin(): Promise<void> {
  const user = await getUser()
  const admin = process.env.PLATFORM_ADMIN_EMAIL
  if (!user?.email || !admin || user.email !== admin) throw new Error('Unauthorized')
}

async function organizationNames(supabase: GameStatsClient, ids: string[]): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('organizations').select('id, name').in('id', ids)
  if (error) return {}
  return Object.fromEntries(((data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]))
}

/** Organizations / games / traffic sources that have game events in the window (filter selectors). */
export async function getGameAdminOptions(input: { from: string; to: string }): Promise<GameAdminOptions> {
  await requirePlatformAdmin()
  const range = parseGameRange(input?.from, input?.to)
  if (!range) throw new Error('Invalid period')
  const supabase = createServiceRoleClient() as unknown as GameStatsClient
  return loadGameAdminOptions(supabase, range, (ids) => organizationNames(supabase, ids))
}

/** Every global panel for one filter set. orgId omitted / "all" = all organizations. */
export async function getGameAdminData(input: GameAdminInput): Promise<GameAdminData> {
  await requirePlatformAdmin()
  const filters = parseGameAdminInput(input)
  if (!filters) throw new Error('Invalid filters')
  return loadGameAdminData(createServiceRoleClient() as unknown as GameStatsClient, filters)
}

/** Fighter picks side by side for one segmentation (period, device, guest vs signed in, source). */
export async function getGameAdminPickSegments(input: GameAdminInput, by: GameSegmentBy): Promise<GamePickSegment[]> {
  await requirePlatformAdmin()
  const filters = parseGameAdminInput(input)
  if (!filters || !SEGMENTS.includes(by)) throw new Error('Invalid filters')
  return loadGamePickSegments(createServiceRoleClient() as unknown as GameStatsClient, filters, by)
}
