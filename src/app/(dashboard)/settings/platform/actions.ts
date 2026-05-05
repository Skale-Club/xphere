'use server'

import { getUser } from '@/lib/supabase/server'
import { getPlatformSettingHint, setPlatformSetting } from '@/lib/platform-settings'
import {
  MANAGED_PLATFORM_KEYS,
  PLATFORM_KEY_META,
  type PlatformKey,
  type PlatformSettingEntry,
} from '@/lib/platform-keys'
import { revalidatePath } from 'next/cache'

async function assertPlatformAdmin() {
  const user = await getUser()
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL
  if (!user || !adminEmail || user.email !== adminEmail) {
    throw new Error('Unauthorized')
  }
  return user
}

export async function getPlatformSettingsForAdmin(): Promise<
  { settings: PlatformSettingEntry[] } | { error: string }
> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { error: 'Unauthorized' }
  }

  const settings = await Promise.all(
    MANAGED_PLATFORM_KEYS.map(async (key) => ({
      key,
      hint: await getPlatformSettingHint(key),
      label: PLATFORM_KEY_META[key].label,
      description: PLATFORM_KEY_META[key].description,
      tab: PLATFORM_KEY_META[key].tab,
    }))
  )

  return { settings }
}

export async function savePlatformSetting(
  key: PlatformKey,
  value: string
): Promise<{ error?: string }> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { error: 'Unauthorized' }
  }

  if (!value.trim()) return { error: 'Value cannot be empty.' }
  if (!(MANAGED_PLATFORM_KEYS as readonly string[]).includes(key)) {
    return { error: 'Unknown key.' }
  }

  try {
    await setPlatformSetting(key, value.trim())
    revalidatePath('/settings/platform')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save.' }
  }
}
