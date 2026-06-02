// Sentry server-side init (O2). DSN-gated: with no DSN, Sentry is disabled and
// all capture calls are no-ops. The same SDK works for hosted Sentry or a
// self-hosted GlitchTip instance — only the DSN differs.
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
})
