import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xphere.skale.club'

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login'],
        disallow: ['/dashboard/', '/admin/', '/api/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
