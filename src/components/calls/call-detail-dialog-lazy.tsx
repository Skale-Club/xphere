'use client'

import dynamic from 'next/dynamic'

export const CallDetailDialogLazy = dynamic(
  () => import('./call-detail-dialog').then((m) => m.CallDetailDialog),
  { ssr: false },
)
