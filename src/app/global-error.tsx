'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import '@/app/globals.css'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col items-center justify-center gap-4">
          <h1 className="text-xl font-semibold">Something went wrong.</h1>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
