// Vapi webhook secret verification.
// Vapi sends the configured `serverSecret` in the X-Vapi-Secret header.
// If VAPI_WEBHOOK_SECRET is unset (dev/local), verification is skipped and a warning is logged.

import { timingSafeEqual } from 'crypto'
import * as Sentry from '@sentry/nextjs'

let warnedMissing = false

export function verifyVapiSecret(request: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET
  if (!expected) {
    if (!warnedMissing) {
      console.warn('[vapi] VAPI_WEBHOOK_SECRET is not set | webhook signature verification disabled.')
      // Deliberately NOT fail-closed: rejecting every Vapi webhook when the
      // secret is unset would take down call ingestion in any environment
      // that's missing the env var, which is worse than the (already-flagged)
      // security gap. This alert exists so the gap doesn't go unnoticed.
      Sentry.captureMessage('Vapi webhook signature verification disabled', {
        level: 'warning',
        tags: { event: 'vapi_webhook_secret_missing' },
      })
      warnedMissing = true
    }
    return true
  }

  const received = request.headers.get('x-vapi-secret')
  if (!received) return false

  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
