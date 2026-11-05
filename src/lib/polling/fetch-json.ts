/**
 * GET a `/api/poll/*` route from the browser. Throws on any non-2xx so
 * `usePolling` backs off and the caller keeps its last known state. Same-origin,
 * so `installTabOrgFetch` adds the tab's org header.
 */
export async function pollFetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) throw new Error(`poll ${url.split('?')[0]} failed (${res.status})`)
  return (await res.json()) as T
}
