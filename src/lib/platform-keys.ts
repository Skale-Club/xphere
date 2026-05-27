export const MANAGED_PLATFORM_KEYS = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
] as const
export type PlatformKey = (typeof MANAGED_PLATFORM_KEYS)[number]

export const PLATFORM_KEY_META: Record<
  PlatformKey,
  { label: string; description: string; tab: string }
> = {
  OPENROUTER_API_KEY: {
    label: 'OpenRouter API Key (platform default)',
    description:
      'Single key that powers Copilot, AI workflow builder, knowledge synthesis, AI email generation, and the MCP/Copilot template generator for every org that hasn\'t connected its own. Get it from https://openrouter.ai/keys. Preferred over Anthropic — one key covers Claude, GPT, Llama, etc.',
    tab: 'AI provider',
  },
  ANTHROPIC_API_KEY: {
    label: 'Anthropic API Key (fallback)',
    description:
      'Used only when OpenRouter is not configured (neither here nor on the org). Get it from https://console.anthropic.com/settings/keys.',
    tab: 'AI provider',
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
