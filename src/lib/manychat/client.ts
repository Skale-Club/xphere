// src/lib/manychat/client.ts
// ManyChat REST API fetch wrapper | mirrors src/lib/ghl/client.ts.
// Single auth-header / timeout / base-URL boundary used by all outbound executors.
//
// Phase 25: TODO | refactor src/app/(dashboard)/integrations/manychat/actions.ts
// `testManychatConnection` (lines 72-91) to use this wrapper. Deferred per CONTEXT.

const MANYCHAT_BASE_URL = 'https://api.manychat.com'
const TIMEOUT_MS = 5000  // 5s | matches testManychatConnection budget

export interface ManychatCredentials {
  apiKey: string         // decrypted ManyChat API token (Bearer)
  locationId: string     // unused by ManyChat; kept for compat with GhlCredentials
}

export async function manychatFetch(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  credentials: ManychatCredentials,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await fetch(`${MANYCHAT_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function manychatFetchJson<T>(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  credentials: ManychatCredentials,
): Promise<T> {
  const response = await manychatFetch(path, method, body, credentials)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`ManyChat API error ${response.status}: ${errorText}`)
  }
  return response.json() as Promise<T>
}
