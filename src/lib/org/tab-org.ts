import { ORG_HEADER, isOrgId, splitOrgPath } from '@/lib/org/request-org'

/**
 * The org THIS browser tab is pinned to (client-only module state — each tab
 * has its own). Seeded from the URL prefix and kept in sync by <OrgTabSync>.
 */
let tabOrgId: string | null =
  typeof window === 'undefined' ? null : (splitOrgPath(window.location.pathname)?.orgId ?? null)

export function getTabOrgId(): string | null {
  return tabOrgId
}

export function setTabOrgId(orgId: string | null): void {
  // Server renders share module state across requests — never write it there.
  if (typeof window === 'undefined') return
  tabOrgId = isOrgId(orgId) ? orgId.toLowerCase() : null
}

/** Copy of `init`/`input` headers with the tab org added (never overriding). */
export function withTabOrgHeader(headers: HeadersInit | undefined): Headers {
  const result = new Headers(headers)
  if (tabOrgId && !result.has(ORG_HEADER)) result.set(ORG_HEADER, tabOrgId)
  return result
}

let installed = false

/**
 * Tag every same-origin request from this tab with its org: Next.js RSC
 * navigations and prefetches, server actions and `/api` calls. Without it a
 * request issued while the address bar is momentarily unprefixed (right after
 * a soft navigation to a plain `/contacts` link) would resolve the user's
 * default org — and could cache another org's data in this tab.
 */
export function installTabOrgFetch(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!tabOrgId) return nativeFetch(input, init)
    let url: URL
    try {
      url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    } catch {
      return nativeFetch(input, init)
    }
    if (url.origin !== window.location.origin) return nativeFetch(input, init)
    if (input instanceof Request) {
      return nativeFetch(new Request(input, { ...init, headers: withTabOrgHeader(init?.headers ?? input.headers) }))
    }
    return nativeFetch(input, { ...init, headers: withTabOrgHeader(init?.headers) })
  }
}
