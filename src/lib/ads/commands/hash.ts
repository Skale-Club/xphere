import { createHash, randomBytes } from 'node:crypto'

/**
 * JSON.stringify with object keys sorted at every depth, so two snapshots that
 * differ only in key order (Google and Meta both reorder fields between calls)
 * hash identically.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hashState(fields: Record<string, unknown>): string {
  return sha256(stableStringify(fields))
}

/** One-time confirmation nonce for AI approvals; only its hash is stored. */
export function newConfirmationToken(): { token: string; hash: string } {
  const token = `adsc_${randomBytes(18).toString('base64url')}`
  return { token, hash: sha256(token) }
}
