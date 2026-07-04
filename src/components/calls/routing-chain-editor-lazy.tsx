'use client'

import dynamic from 'next/dynamic'

export const RoutingChainEditorLazy = dynamic(
  () => import('./routing-chain-editor').then((m) => m.RoutingChainEditor),
  { ssr: false },
)
