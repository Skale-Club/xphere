import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xphere.app'

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/dashboard/', '/admin/', '/api/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
