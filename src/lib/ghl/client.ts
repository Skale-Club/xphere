// src/lib/ghl/client.ts
// GHL API v2 fetch wrapper | Edge Runtime safe (uses native fetch)

const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
const GHL_API_VERSION = '2021-07-28'
export const DEFAULT_TIMEOUT_MS = 400  // 400ms hard limit | keeps hot path within 500ms Vapi budget

export interface GhlCredentials {
  apiKey: string       // decrypted Private Integration Token
  locationId: string   // GHL sub-account location ID
}

export async function ghlFetch(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown | null,
  credentials: GhlCredentials,
  queryParams?: Record<string, string>,
  timeoutMs?: number
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let url = `${GHL_BASE_URL}${path}`
  if (queryParams && Object.keys(queryParams).length > 0) {
    url += '?' + new URLSearchParams(queryParams).toString()
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${credentials.apiKey}`,
        'Version': GHL_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function ghlFetchJson<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown | null,
  credentials: GhlCredentials,
  queryParams?: Record<string, string>,
  timeoutMs?: number
): Promise<T> {
  const response = await ghlFetch(path, method, body, credentials, queryParams, timeoutMs)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`GHL API error ${response.status}: ${errorText}`)
  }
  return response.json() as Promise<T>
}
