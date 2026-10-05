import 'server-only'

// Which rank provider a scan runs on, and with whose credentials.
//
// D1/D4 (SPEC section 1): the platform pays the provider and charges points
// against the plan quota. DataForSEO (async, ~25x cheaper) is preferred; the
// platform SerpAPI key is the fallback. LOCAL_SEO_PROVIDER forces one
// ('dataforseo' | 'serpapi' | 'fake'); 'fake' runs offline for dev/QA.
//
// An org's own SerpAPI key (saved for Google Reviews) is deliberately NOT used
// for geogrid scans: the free SerpAPI tier is 100 searches/month and a single
// 7x7 scan would spend half of it. It is only used for the one-off business
// search when adding a location and the platform has no key.

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/crypto'
import { getPlatformSetting } from '@/lib/platform-settings'
import type { Database } from '@/types/database'

import type { ProviderId } from './types'
import { createDataForSeoProvider } from './providers/dataforseo'
import { createFakeProvider } from './providers/fake'
import { createSerpApiProvider } from './providers/serpapi'
import type { RankProvider } from './providers/types'

type Admin = SupabaseClient<Database>

/** Platform setting (admin UI) first, environment variable second. */
async function platformCredential(admin: Admin, key: string): Promise<string | null> {
  const stored = await getPlatformSetting(key, admin).catch(() => null)
  return stored?.trim() || process.env[key]?.trim() || null
}

async function dataForSeoCredentials(admin: Admin) {
  const [login, password] = await Promise.all([
    platformCredential(admin, 'DATAFORSEO_LOGIN'),
    platformCredential(admin, 'DATAFORSEO_PASSWORD'),
  ])
  return login && password ? { login, password } : null
}

export type ProviderTarget = { placeId: string | null; name: string; lat: number; lng: number }

/** The provider new scans should use, or null when none is configured. */
export async function pickProviderId(admin: Admin): Promise<ProviderId | null> {
  const forced = process.env.LOCAL_SEO_PROVIDER as ProviderId | undefined
  if (forced === 'fake') return 'fake'
  if (forced !== 'serpapi' && (await dataForSeoCredentials(admin))) return 'dataforseo'
  if (forced !== 'dataforseo' && (await platformCredential(admin, 'SERPAPI_API_KEY'))) return 'serpapi'
  return null
}

/** Instantiate the provider a scan was created with. */
export async function providerFor(
  admin: Admin,
  id: ProviderId,
  target: ProviderTarget,
): Promise<RankProvider | null> {
  if (id === 'fake') return createFakeProvider(target)
  if (id === 'dataforseo') {
    const creds = await dataForSeoCredentials(admin)
    return creds ? createDataForSeoProvider(creds.login, creds.password) : null
  }
  const key = await platformCredential(admin, 'SERPAPI_API_KEY')
  return key ? createSerpApiProvider(key) : null
}

/** Static facts about a provider, without credentials (for estimates). */
export function providerProfile(id: ProviderId): { mode: 'sync' | 'async'; costPerPointUsd: number } {
  if (id === 'dataforseo') return { mode: 'async', costPerPointUsd: 0.0006 }
  if (id === 'serpapi') return { mode: 'sync', costPerPointUsd: 0.015 }
  return { mode: 'sync', costPerPointUsd: 0 }
}

/**
 * SerpAPI key for the one-off business searches (adding a Local SEO location,
 * the Reviews → Review link tool): the platform key, else any key the org
 * saved for Google Reviews.
 */
export async function businessSearchKey(admin: Admin, orgId: string): Promise<string | null> {
  const platform = await platformCredential(admin, 'SERPAPI_API_KEY')
  if (platform) return platform
  const { data } = await admin
    .from('google_business_profiles')
    .select('serpapi_key_encrypted')
    .eq('org_id', orgId)
    .not('serpapi_key_encrypted', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data?.serpapi_key_encrypted) return null
  try {
    return await decrypt(data.serpapi_key_encrypted)
  } catch {
    return null
  }
}

/** Shared secret embedded in the DataForSEO postback URL. */
export function postbackSecret(): string | null {
  return process.env.LOCAL_SEO_POSTBACK_SECRET?.trim() || null
}
