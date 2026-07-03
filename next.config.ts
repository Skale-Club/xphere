import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'
import { withSentryConfig } from '@sentry/nextjs'

const withSerwist = withSerwistInit({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
})

const nextConfig: NextConfig = {
  output: 'standalone',
  // playwright and cheerio use native modules / dynamic requires — they must
  // NOT be bundled by webpack. sharp is excluded for the same reason.
  serverExternalPackages: ['sharp', 'playwright', 'playwright-core', 'cheerio'],
  turbopack: {},
  async redirects() {
    return [
      // Legacy /accounts URLs now point to the canonical /companies route.
      { source: '/accounts', destination: '/companies', permanent: true },
      { source: '/accounts/:path*', destination: '/companies/:path*', permanent: true },
      // /settings/workspace renamed to /settings/company-info
      { source: '/settings/workspace', destination: '/settings/company-info', permanent: true },
      // Traffic feature renamed to Analytics (UI + slug); API routes stay /api/traffic/*.
      { source: '/traffic', destination: '/analytics', permanent: true },
      { source: '/admin/traffic', destination: '/admin/analytics', permanent: true },
      // Traffic settings page became a modal inside /analytics.
      { source: '/settings/traffic', destination: '/analytics?settings=1', permanent: true },
      // Chat inbox page moved from /chat to /inbox. Query strings (?conversation=,
      // ?contact=) are preserved automatically, so already-delivered push
      // notifications and bookmarks with /chat URLs keep working. Note: /api/chat/*
      // is unaffected — this only matches the /chat page path.
      { source: '/chat', destination: '/inbox', permanent: true },
    ]
  },
  async rewrites() {
    return [
      // Compat shim: the analytics tracking script renamed its API from
      // /api/traffic/* to /api/analytics/*. Tracking snippets already deployed
      // on customer sites still POST to the old path — rewrite (not redirect, to
      // preserve the POST body cross-origin) so live data keeps flowing until
      // those sites reinstall the new snippet.
      { source: '/api/traffic/:path*', destination: '/api/analytics/:path*' },
    ]
  },
  async headers() {
    const isProd = process.env.NODE_ENV === 'production'
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

    // CSP is deployed in Report-Only mode first. After a week of observing
    // violation reports in production, switch the directive name to
    // `Content-Security-Policy` to enforce. Inline + eval are kept on for now
    // because Next.js dev tooling and shadcn/sonner toasts still rely on them;
    // tighten these as part of the CSP enforcement follow-up.
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Twilio Voice SDK browser calling opens a signaling WebSocket to
      // chunderw-*.twilio.com and posts insights to eventgw.twilio.com. (WebRTC
      // media itself is exempt from connect-src.) Required once CSP enforces.
      `connect-src 'self' ${supabaseUrl} https://*.supabase.co wss://*.supabase.co https://*.twilio.com wss://*.twilio.com`,
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "frame-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')

    const commonHeaders = [
      { key: 'Content-Security-Policy-Report-Only', value: cspDirectives },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // microphone=(self) | required for Twilio Voice SDK browser calling on our
      // own origin. camera/geolocation/payment stay fully locked (unused).
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=()' },
      ...(isProd
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
        : []),
    ]

    // Embed widgets (chat, reviews) MUST be embeddable on customer sites, so
    // they override the global frame-ancestors policy. They are served from
    // /widget and /widget/reviews. The rest of the app stays DENY.
    const widgetHeaders = [
      ...commonHeaders.filter(h => h.key !== 'X-Frame-Options'),
      // No X-Frame-Options — fall back to CSP frame-ancestors which is
      // overridden in the widget-specific CSP below.
      {
        key: 'Content-Security-Policy-Report-Only',
        value: cspDirectives.replace("frame-ancestors 'none'", "frame-ancestors *"),
      },
    ].filter((h, i, arr) => arr.findIndex(x => x.key === h.key) === i)

    return [
      { source: '/widget/:path*', headers: widgetHeaders },
      { source: '/:path*', headers: commonHeaders },
    ]
  },
}

nextConfig.allowedDevOrigins = ['192.168.56.1']

export default withSentryConfig(withSerwist(nextConfig), {
  // No telemetry from our builds
  telemetry: false,
  // Silent in build output (set CI=true to see warnings)
  silent: true,
  // Sentry org + project for source-map upload (set via env in Coolify)
  org: process.env.SENTRY_ORG ?? 'skale-club',
  project: process.env.SENTRY_PROJECT ?? 'xphere',
  // Source-map upload and release creation only when auth token is present.
  // Set SENTRY_AUTH_TOKEN as a GitHub secret to enable; omit to skip silently.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  release: {
    create: Boolean(process.env.SENTRY_AUTH_TOKEN),
    finalize: Boolean(process.env.SENTRY_AUTH_TOKEN),
  },
})
