'use client'

/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect } from 'react'

/**
 * Dashboard segment error boundary.
 *
 * IMPORTANT | this file is intentionally pure HTML + inline styles.
 * It MUST NOT import anything from the dashboard tree (no Button,
 * no PageHeader, no design-system components, no provider hooks).
 *
 * Why: a render error in the dashboard tree bubbles up here. If the
 * error boundary itself depends on the same providers / tokens that
 * threw, it will re-throw immediately and Next will re-mount this
 * boundary in a tight loop | producing the "thousands of `i4 → us`
 * recursive frames" we saw in digest 1621801304.
 *
 * Keep it dumb. Keep it dependency-free.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard error boundary]', {
      digest: error.digest,
      message: error.message,
      stack: error.stack,
    })
    // Dynamic import keeps this boundary truly dependency-free at parse time.
    // If Sentry itself fails to load, the boundary still renders correctly.
    import('@sentry/nextjs').then(({ captureException }) => captureException(error)).catch(() => {})

    const details = `${error.name}\n${error.message}\n${error.stack ?? ''}`.toLowerCase()
    const looksLikeStaleChunk =
      details.includes('chunkloaderror') ||
      details.includes('failed to load chunk') ||
      details.includes('/_next/static/chunks/')

    if (!looksLikeStaleChunk || typeof window === 'undefined') return

    const reloadKey = 'xphere.chunk-recovery-reloaded'
    if (window.sessionStorage.getItem(reloadKey) === '1') return
    window.sessionStorage.setItem(reloadKey, '1')

    ;(async () => {
      try {
        const registrations = await window.navigator.serviceWorker?.getRegistrations?.()
        await Promise.all(registrations?.map((registration) => registration.unregister()) ?? [])
        if ('caches' in window) {
          const names = await window.caches.keys()
          await Promise.all(names.map((name) => window.caches.delete(name)))
        }
      } catch {
        // The reload is still useful even if cache cleanup is unavailable.
      } finally {
        window.location.reload()
      }
    })()
  }, [error])

  return (
    <div
      style={{
        padding: 24,
        color: '#FAFAFA',
        backgroundColor: '#0A0A0B',
        minHeight: '100vh',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
      }}
    >
      <div style={{ maxWidth: 560, margin: '4rem auto' }}>
        <h1 style={{ fontSize: 22, marginBottom: 12, fontWeight: 600 }}>
          Dashboard error
        </h1>
        <p style={{ color: '#A1A1AA', marginBottom: 16, fontSize: 14, lineHeight: 1.5 }}>
          We hit an unexpected error rendering this page. The team has been
          notified.
        </p>
        <p style={{ color: '#71717A', marginBottom: 24, fontSize: 12 }}>
          Digest:{' '}
          <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {error.digest ?? 'unknown'}
          </code>
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: '8px 16px',
            backgroundColor: '#6366F1',
            border: 'none',
            borderRadius: 8,
            color: '#FFFFFF',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        <div style={{ marginTop: 32, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <a href="/inbox" style={{ color: '#818CF8', fontSize: 13 }}>
            Inbox
          </a>
          <a href="/contacts" style={{ color: '#818CF8', fontSize: 13 }}>
            Contacts
          </a>
          <a href="/pipeline" style={{ color: '#818CF8', fontSize: 13 }}>
            Pipeline
          </a>
          <a href="/agents" style={{ color: '#818CF8', fontSize: 13 }}>
            Agents
          </a>
          <a href="/integrations" style={{ color: '#818CF8', fontSize: 13 }}>
            Integrations
          </a>
        </div>
      </div>
    </div>
  )
}
