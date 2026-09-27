import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { shouldShowDashboardTour } from '@/lib/onboarding/tour-state'

describe('dashboard onboarding tour visibility', () => {
  it('stays hidden when the user already has a completion record', async () => {
    const lookupCompletion = async () => '2026-09-27T12:00:00.000Z'

    await expect(
      shouldShowDashboardTour('existing-user', lookupCompletion),
    ).resolves.toBe(false)
  })

  it('is shown to a new user without a completion record', async () => {
    const lookupCompletion = async () => null

    await expect(
      shouldShowDashboardTour('new-user', lookupCompletion),
    ).resolves.toBe(true)
  })

  it('fails closed when completion state cannot be loaded', async () => {
    const lookupCompletion = async (): Promise<string | null> => {
      throw new Error('database unavailable')
    }

    await expect(
      shouldShowDashboardTour('unknown-user', lookupCompletion),
    ).resolves.toBe(false)
  })
})

describe('dashboard onboarding tour migration', () => {
  it('marks every existing auth user as having completed the current tour', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/1307_user_tour_progress.sql',
      ),
      'utf8',
    )

    expect(sql).toMatch(/INSERT INTO public\.user_tour_progress/i)
    expect(sql).toMatch(/SELECT\s+id,\s*'dashboard-v1'/i)
    expect(sql).toMatch(/FROM auth\.users/i)
    expect(sql).toMatch(/ON CONFLICT \(user_id, tour_key\) DO NOTHING/i)
  })

  it('keeps the generated database contract in sync with tour progress', () => {
    const databaseTypes = readFileSync(
      resolve(process.cwd(), 'src/types/database.ts'),
      'utf8',
    )

    expect(databaseTypes).toMatch(/user_tour_progress:\s*\{/)
    expect(databaseTypes).toMatch(/tour_key:\s*string/)
    expect(databaseTypes).toMatch(/completed_at:\s*string/)
  })
})
