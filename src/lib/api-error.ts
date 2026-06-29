import * as Sentry from '@sentry/nextjs'

// Call this in catch blocks of API route handlers to forward the error to
// Sentry without re-throwing (which would double-capture via onRequestError).
// The route handler is still responsible for returning an appropriate Response.
export function captureApiError(
  error: unknown,
  extras?: Record<string, unknown>,
): void {
  if (extras) {
    Sentry.withScope(scope => {
      scope.setExtras(extras)
      Sentry.captureException(error)
    })
  } else {
    Sentry.captureException(error)
  }
}
