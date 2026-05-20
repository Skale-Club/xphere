import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  async redirects() {
    return [
      // Legacy /accounts URLs now point to the canonical /companies route.
      { source: '/accounts', destination: '/companies', permanent: true },
      { source: '/accounts/:path*', destination: '/companies/:path*', permanent: true },
    ]
  },
}

nextConfig.allowedDevOrigins = ['192.168.56.1']

export default nextConfig
