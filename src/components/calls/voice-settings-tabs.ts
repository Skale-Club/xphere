export type VoiceSettingsTab = 'numbers' | 'routing' | 'assistants' | 'general'

/**
 * Plain (non-'use client') module so Server Components can call this directly
 * to validate `?settings=`. A function exported from a 'use client' file is a
 * client reference and cannot be invoked from server code — only rendered as
 * a Component or passed as a prop — which is what crashed the Calls page.
 */
export function isVoiceSettingsTab(v: string | undefined): v is VoiceSettingsTab {
  return v === 'numbers' || v === 'routing' || v === 'assistants' || v === 'general'
}
