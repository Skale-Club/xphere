// src/lib/webhooks/verify-shared-secret.ts
// Timing-safe comparison of a header-supplied secret against an expected value.
// Used by webhook receivers (zapi, wapi) where the provider sends a static
// shared secret on every request and we need to reject mismatches without
// leaking timing information about how many characters matched.
//
// Returns:
//   - 'ok'         | both strings are non-empty and equal
//   - 'missing'    | header absent or empty (provider not sending the secret)
//   - 'unconfigured' | server-side expected secret is empty (caller must decide)
//   - 'mismatch'   | both present, lengths or contents differ

export type VerifySharedSecretResult = 'ok' | 'missing' | 'unconfigured' | 'mismatch'

export function verifySharedSecret(
  sent: string | null | undefined,
  expected: string | null | undefined,
): VerifySharedSecretResult {
  const expectedStr = (expected ?? '').toString()
  if (expectedStr.length === 0) return 'unconfigured'

  const sentStr = (sent ?? '').toString()
  if (sentStr.length === 0) return 'missing'

  if (sentStr.length !== expectedStr.length) return 'mismatch'

  let diff = 0
  for (let i = 0; i < expectedStr.length; i++) {
    diff |= sentStr.charCodeAt(i) ^ expectedStr.charCodeAt(i)
  }
  return diff === 0 ? 'ok' : 'mismatch'
}
