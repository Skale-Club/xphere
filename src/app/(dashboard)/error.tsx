'use client'

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
    // eslint-disable-next-line no-console
    console.error('[dashboard error boundary]', {
      digest: error.digest,
      message: error.message,
      stack: error.stack,
    })
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
          <a href="/chat" style={{ color: '#818CF8', fontSize: 13 }}>
            Chat
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
