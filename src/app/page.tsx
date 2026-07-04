import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LandingPage } from '@/components/landing/landing-page'
import { getFaviconUrl, getSeoMetadataConfig } from '@/lib/seo'
import { getLandingPublicConfig } from '@/lib/landing/public-config'
import { getSiteOrigin } from '@/lib/site-url'
import { getUser } from '@/lib/supabase/server'

const SITE_URL = getSiteOrigin()

export async function generateMetadata(): Promise<Metadata> {
  const seoConfig = await getSeoMetadataConfig()
  const ogImages = seoConfig?.ogImageUrl ? [{ url: seoConfig.ogImageUrl }] : undefined

  return {
    title: 'Xphere | The AI Operations Platform for Modern Businesses',
    description:
      'Centralize AI assistants, automate client workflows, and manage every interaction | voice, chat, SMS, and WhatsApp | from one powerful dashboard.',
    openGraph: {
      title: 'Xphere | The AI Operations Platform',
      description:
        'Centralize AI assistants, automate client workflows, and manage every interaction from one powerful dashboard.',
      url: SITE_URL,
      siteName: 'Xphere',
      type: 'website',
      locale: 'en_US',
      images: ogImages,
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Xphere | The AI Operations Platform',
      description:
        'Centralize AI assistants, automate client workflows, and manage every interaction from one powerful dashboard.',
      images: ogImages,
    },
    keywords: ['AI operations', 'business platform', 'AI assistants', 'workflow automation', 'CRM', 'multi-channel inbox'],
    alternates: { canonical: SITE_URL },
  }
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Xphere',
      url: SITE_URL,
      description: 'The AI Operations Platform for Modern Businesses',
    },
    {
      '@type': 'WebSite',
      url: SITE_URL,
      name: 'Xphere',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE_URL}/`,
      },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Xphere',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'AI Operations Platform | centralize AI assistants, automate client workflows, manage voice, chat, SMS, and WhatsApp in one dashboard.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      url: SITE_URL,
    },
  ],
}

export default async function RootPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = (await searchParams) ?? {}
  if (typeof sp.code === 'string' && sp.code) {
    const callbackParams = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (Array.isArray(value)) {
        value.forEach((item) => callbackParams.append(key, item))
      } else if (typeof value === 'string') {
        callbackParams.set(key, value)
      }
    }
    if (!callbackParams.has('next')) {
      callbackParams.set('next', '/dashboard')
    }
    redirect(`/auth/callback?${callbackParams.toString()}`)
  }

  const [faviconUrl, landing, user] = await Promise.all([
    getFaviconUrl(),
    getLandingPublicConfig(),
    getUser(),
  ])

  // Authenticated users have no reason to see the landing page.
  // Redirect them straight to the dashboard — this also breaks the
  // "double-login" loop where a timing edge-case sends an authenticated
  // user back to "/" after the OAuth callback.
  if (user) redirect('/dashboard')

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingPage
        faviconUrl={faviconUrl}
        ctaImageUrl={landing.ctaImageUrl}
        scrollImages={landing.scrollImages}
        isAuthenticated={Boolean(user)}
        demoEnabled={Boolean(process.env.DEMO_ORG_ID)}
      />
    </>
  )
}
