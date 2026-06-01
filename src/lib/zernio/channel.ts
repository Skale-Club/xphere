// src/lib/zernio/channel.ts
// Single source of truth for Zernio per-platform channel values.
// A Zernio conversation's channel is `zernio_<platform>` (e.g. zernio_instagram)
// so each platform shows as its own channel in the inbox (icon, label, filter).
// Unknown platforms fall back to the generic `zernio` so a CHECK constraint is
// never violated by a platform we haven't whitelisted yet.

export const ZERNIO_PLATFORMS = [
  'instagram',
  'facebook',
  'telegram',
  'whatsapp',
  'linkedin',
  'tiktok',
  'twitter',
  'threads',
  'youtube',
] as const

export type ZernioPlatform = (typeof ZERNIO_PLATFORMS)[number]

const ZERNIO_PLATFORM_SET = new Set<string>(ZERNIO_PLATFORMS)

/** All valid Zernio channel values (`zernio` + `zernio_<platform>`). */
export const ZERNIO_CHANNELS = ['zernio', ...ZERNIO_PLATFORMS.map((p) => `zernio_${p}`)] as const

/** Maps a Zernio platform to its channel value; unknown → generic `zernio`. */
export function zernioChannel(platform: string | null | undefined): string {
  if (platform && ZERNIO_PLATFORM_SET.has(platform)) return `zernio_${platform}`
  return 'zernio'
}

/** Extracts the platform from a `zernio_<platform>` channel; else null. */
export function zernioPlatform(channel: string | null | undefined): ZernioPlatform | null {
  if (!channel || !channel.startsWith('zernio_')) return null
  const platform = channel.slice('zernio_'.length)
  return ZERNIO_PLATFORM_SET.has(platform) ? (platform as ZernioPlatform) : null
}

/** True for the generic `zernio` channel or any `zernio_<platform>`. */
export function isZernioChannel(channel: string | null | undefined): boolean {
  return channel === 'zernio' || (!!channel && channel.startsWith('zernio_'))
}
