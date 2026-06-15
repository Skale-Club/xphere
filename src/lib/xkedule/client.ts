// src/lib/xkedule/client.ts
// HTTP client for the Xkedule /api/v1 integration surface.
// Per-org credentials (Settings → Integrations → Xkedule): tenantBaseUrl
// resolves the tenant by host; apiKey is the connection token sent as
// X-Xkedule-Key and validated against the tenant's stored value. No env vars.

export const DEFAULT_TIMEOUT_MS = 5000

export interface XkeduleCredentials {
  tenantBaseUrl: string
  apiKey: string
}

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
      'X-Xkedule-Key': credentials.apiKey,
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
