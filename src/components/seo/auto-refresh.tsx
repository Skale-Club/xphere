'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Re-render the server component every `ms` while mounted (e.g. waiting on a sync). */
export function AutoRefresh({ ms = 5000 }: { ms?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => router.refresh(), ms)
    return () => clearInterval(id)
  }, [router, ms])
  return null
}
