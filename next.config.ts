import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'

const withSerwist = withSerwistInit({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
})

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp'],
  turbopack: {},
  async redirects() {
    return [
      // Legacy /accounts URLs now point to the canonical /companies route.
      { source: '/accounts', destination: '/companies', permanent: true },
      { source: '/accounts/:path*', destination: '/companies/:path*', permanent: true },
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      `connect-src 'self' ${supabaseUrl} https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com`,
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
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
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

export default withSerwist(nextConfig)
