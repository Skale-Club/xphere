// src/lib/zernio/client.ts
// Zernio REST API wrapper — mirrors src/lib/manychat/client.ts.
// All outbound calls (send DM, register webhook) go through zernioFetch.

const ZERNIO_BASE_URL = 'https://zernio.com/api/v1'
const TIMEOUT_MS = 8000

export async function zernioFetch(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown | null,
  apiKey: string,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await fetch(`${ZERNIO_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function zernioFetchJson<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown | null,
  apiKey: string,
): Promise<T> {
  const response = await zernioFetch(path, method, body, apiKey)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Zernio API error ${response.status}: ${errorText}`)
  }
  return response.json() as Promise<T>
}

/** Validates an API key by listing accounts. Returns true if key is valid. */
export async function testZernioApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await zernioFetchJson('/accounts', 'GET', null, apiKey)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid API key' }
  }
}
