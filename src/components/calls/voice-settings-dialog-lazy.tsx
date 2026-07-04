'use client'

import dynamic from 'next/dynamic'

export const VoiceSettingsDialogLazy = dynamic(
  () => import('./voice-settings-dialog').then((m) => m.VoiceSettingsDialog),
  { ssr: false },
)
