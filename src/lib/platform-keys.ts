// OpenRouter is the only LLM credential the platform manages. One key reaches
// Claude, GPT, Llama and the rest; a second provider key was only ever a second
// way to be misconfigured (and silently was — see resolve-provider.ts).
//
// The Local SEO keys are the platform's own Maps SERP accounts: geogrid scans
// are billed per point against a plan quota, so the platform pays the provider
// and an org never has to bring a key (it still can — see
// src/lib/local-seo/credentials.ts).
export const MANAGED_PLATFORM_KEYS = [
  'OPENROUTER_API_KEY',
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'SERPAPI_API_KEY',
] as const
export type PlatformKey = (typeof MANAGED_PLATFORM_KEYS)[number]

export const PLATFORM_KEY_META: Record<
  PlatformKey,
  { label: string; description: string; tab: string }
> = {
  OPENROUTER_API_KEY: {
    label: 'OpenRouter API Key (platform default)',
    description:
      'The single key behind every AI feature — agents, Copilot, AI workflow builder, knowledge synthesis, AI email generation — for every org that has not connected its own. One key covers Claude, GPT, Llama and the rest. Get it from https://openrouter.ai/keys.',
    tab: 'AI provider',
  },
  DATAFORSEO_LOGIN: {
    label: 'DataForSEO login',
    description:
      'Primary Local SEO rank provider (Google Maps SERP, standard queue). The API login from https://app.dataforseo.com/api-access — not the dashboard email/password.',
    tab: 'Local SEO',
  },
  DATAFORSEO_PASSWORD: {
    label: 'DataForSEO API password',
    description: 'API password paired with the DataForSEO login above.',
    tab: 'Local SEO',
  },
  SERPAPI_API_KEY: {
    label: 'SerpAPI key (platform default)',
    description:
      'Fallback Local SEO rank provider and the business search used to add a location. Orgs that saved their own SerpAPI key for Google Reviews keep using theirs.',
    tab: 'Local SEO',
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
