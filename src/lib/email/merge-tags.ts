// src/lib/email/merge-tags.ts
// Pure merge-tag renderer for builder email templates (UFE-10).
// Fills {{ dot.path }} tokens from a variables object at send time.
// Semantics mirror src/lib/flows/interpolate.ts (dot-path, missing → '')
// but this renderer is email-owned and dependency-free so it is trivially
// unit-testable and reusable by the send_email_template executor + campaigns.

// Matches {{ dot.path }} — identifier segments only, whitespace tolerant.
// Non-path tokens (spaces, punctuation) do NOT match and are left intact.
const TOKEN = /\{\{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\}\}/g

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Replace every {{ dot.path }} token in `input` with the resolved value from
 * `vars`. Missing/undefined/null paths resolve to '' (no raw {{}} left).
 * Object/array values are JSON-stringified. Malformed tokens are left intact.
 */
export function renderWithVariables(
  input: string,
  vars: Record<string, unknown>,
): string {
  if (!input) return input
  return input.replace(TOKEN, (_match, path: string) => {
    const value = resolvePath(vars, path)
    if (value === undefined || value === null) return ''
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  })
}
