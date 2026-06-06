// Sentry client-side init (O2). Mirrors sentry.server.config.ts — DSN-gated.
// Loaded automatically by Next.js when withSentryConfig wraps next.config.ts.
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  // Client-side traces: keep at 0 until we instrument specific user flows.
  tracesSampleRate: 0,
})
