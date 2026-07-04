'use client'

import dynamic from 'next/dynamic'

// wavesurfer.js (~80KB) only needed when a human-call recording is actually
// rendered — lazy-load so it's not part of the calls page's initial bundle.
export const CallWaveformPlayerLazy = dynamic(
  () => import('./call-waveform-player').then((m) => m.CallWaveformPlayer),
  { ssr: false },
)
