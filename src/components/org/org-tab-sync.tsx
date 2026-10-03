'use client'

import { useEffect } from 'react'
import { usePathname as useRawPathname } from 'next/navigation'

import { orgPath, splitOrgPath } from '@/lib/org/request-org'
import { installTabOrgFetch, setTabOrgId } from '@/lib/org/tab-org'

// Before hydration, so the very first prefetch already carries the tab's org.
installTabOrgFetch()

const DEFAULT_SYNC_KEY = 'xph_default_org'
const DEFAULT_SYNC_TTL_MS = 5 * 60 * 1000
const RECOVER_KEY = 'xph_org_recover'
const RECOVER_MAX_ATTEMPTS = 2

/**
 * Pins this browser tab to the org it is rendering (`orgId` comes from the
 * server, i.e. what get_current_org_id() actually resolved for this page):
 *
 * - every same-origin request from the tab carries the org (see tab-org.ts);
 * - the address bar always reads `/o/<org-id>/…`, so a refresh, a bookmark or a
 *   copied link reopens the same org — internal links stay plain (`/contacts`)
 *   and get re-pinned here after each navigation;
 * - when the tab gains focus its org becomes the user's default — where a
 *   fresh visit to xphere.app (no org in the URL) lands. Realtime does not
 *   depend on it: it isolates orgs per subscription (migration 1309).
 */
export function OrgTabSync({ orgId }: { orgId: string | null }) {
  // During render, before any child effect can fire a request.
  setTabOrgId(orgId)
  const rawPathname = useRawPathname()

  // The server rendered no org although the URL pins one. That happens when
  // the render's database calls went out without the user's token — e.g. a
  // transient Supabase Auth error (503) while refreshing an expiring session —
  // and shows up as "Select organization". Reload, like a user would.
  useEffect(() => {
    if (orgId) {
      try {
        sessionStorage.removeItem(RECOVER_KEY)
      } catch {
        // Storage blocked: nothing to reset.
      }
      return
    }
    if (!splitOrgPath(window.location.pathname)) return
    let attempts = 0
    try {
      attempts = Number(sessionStorage.getItem(RECOVER_KEY) ?? 0) || 0
    } catch {
      // Storage blocked: allow a single attempt.
    }
    if (attempts >= RECOVER_MAX_ATTEMPTS) return
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(RECOVER_KEY, String(attempts + 1))
      } catch {
        // Storage blocked: the attempt cap cannot persist; reload anyway.
      }
      window.location.reload()
    }, 1500 * (attempts + 1))
    return () => window.clearTimeout(timer)
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    const { pathname, search, hash } = window.location
    if (splitOrgPath(pathname)?.orgId === orgId) return
    window.history.replaceState(window.history.state, '', `${orgPath(orgId, pathname)}${search}${hash}`)
  }, [orgId, rawPathname])

  useEffect(() => {
    if (!orgId) return
    // focus + visibilitychange usually fire together: one request at a time.
    let inFlight = false
    const sync = async () => {
      if (document.visibilityState !== 'visible' || inFlight) return
      try {
        const [lastOrg, lastAt] = (localStorage.getItem(DEFAULT_SYNC_KEY) ?? '').split('|')
        if (lastOrg === orgId && Date.now() - Number(lastAt) < DEFAULT_SYNC_TTL_MS) return
      } catch {
        // Storage blocked: sync anyway, it is a cheap idempotent upsert.
      }
      inFlight = true
      try {
        const res = await fetch('/api/org/default', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orgId }),
          keepalive: true,
        })
        // Remember only a confirmed sync, so a failure is retried on the next
        // focus instead of being suppressed for the whole TTL.
        if (res.ok) {
          try {
            localStorage.setItem(DEFAULT_SYNC_KEY, `${orgId}|${Date.now()}`)
          } catch {
            // Storage blocked: nothing to remember.
          }
        }
      } catch {
        // Offline / aborted: retried on the next focus.
      } finally {
        inFlight = false
      }
    }
    const onSync = () => void sync()
    onSync()
    window.addEventListener('focus', onSync)
    document.addEventListener('visibilitychange', onSync)
    return () => {
      window.removeEventListener('focus', onSync)
      document.removeEventListener('visibilitychange', onSync)
    }
  }, [orgId])

  return null
}
