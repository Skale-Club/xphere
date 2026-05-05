export const MANAGED_PLATFORM_KEYS = ['GOOGLE_PLACES_API_KEY'] as const
export type PlatformKey = (typeof MANAGED_PLATFORM_KEYS)[number]

export const PLATFORM_KEY_META: Record<
  PlatformKey,
  { label: string; description: string; tab: string }
> = {
  GOOGLE_PLACES_API_KEY: {
    label: 'Google Places API Key',
    description:
      'Used to sync Google reviews for all organizations. Get it from Google Cloud Console → APIs & Services → Credentials.',
    tab: 'Google',
  },
}

export const PLATFORM_TABS = [...new Set(
  Object.values(PLATFORM_KEY_META).map((m) => m.tab)
)] as string[]

export type PlatformSettingEntry = {
  key: PlatformKey
  hint: string | null
  label: string
  description: string
  tab: string
}
