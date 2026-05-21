// src/lib/manychat/subscriber-id.ts
// Resolves a ManyChat subscriber_id from runtime params, with fallbacks
// for inbound-webhook payload shape and legacy callers.
//
// Per RESEARCH.md Pitfall 3: ManyChat accepts BOTH string and integer
// subscriber_id at the API boundary, but rejects empty/null/undefined.
// We pass through unchanged (no coercion) and validate truthiness only.

export function resolveSubscriberId(params: Record<string, unknown>): string | number {
  // Direct top-level (most common | runtime params from rule-driven dispatch)
  if (typeof params.subscriber_id === 'string' || typeof params.subscriber_id === 'number') {
    if (params.subscriber_id !== '' && params.subscriber_id !== 0) {
      return params.subscriber_id
    }
  }

  // Fallback 1: nested under .payload (legacy / future caller shapes)
  const payload = params.payload as Record<string, unknown> | undefined
  if (payload && (typeof payload.subscriber_id === 'string' || typeof payload.subscriber_id === 'number')) {
    if (payload.subscriber_id !== '' && payload.subscriber_id !== 0) {
      return payload.subscriber_id
    }
  }

  // Fallback 2: nested under .user.id (some ManyChat External Request templates)
  const user = params.user as Record<string, unknown> | undefined
  if (user && (typeof user.id === 'string' || typeof user.id === 'number')) {
    if (user.id !== '' && user.id !== 0) {
      return user.id
    }
  }

  throw new Error('subscriber_id is required')
}
