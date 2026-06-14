// src/lib/xkedule/client.ts
// HTTP client for the Xkedule /api/v1 integration surface.
// Tenant is resolved by host (tenantBaseUrl); the X-Xkedule-Key header
// authenticates the Xphere platform (shared secret, F1 pilot).

export const DEFAULT_TIMEOUT_MS = 5000

export interface XkeduleCredentials {
  tenantBaseUrl: string
}

// Shared secret — must equal XPHERE_INTEGRATION_SECRET on the Xkedule side.
const INTEGRATION_KEY = process.env.XKEDULE_INTEGRATION_SECRET ?? ''

async function xkeduleFetch(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  credentials: XkeduleCredentials,
): Promise<Response> {
  const url = `${credentials.tenantBaseUrl.replace(/\/$/, '')}${path}`
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Xkedule-Key': INTEGRATION_KEY,
    },
    body: body !== null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
  return response
}

export async function xkeduleFetchJson<T>(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  credentials: XkeduleCredentials,
): Promise<T> {
  const response = await xkeduleFetch(path, method, body, credentials)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Xkedule API error ${response.status}: ${errorText}`)
  }
  return response.json() as Promise<T>
}
