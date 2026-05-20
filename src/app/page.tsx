import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing/landing-page'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xphere.app'

export const metadata: Metadata = {
  title: 'Xphere — The AI Operations Platform for Modern Agencies',
  description:
    'Centralize AI assistants, automate client workflows, and manage every interaction — voice, chat, SMS, and WhatsApp — from one powerful dashboard.',
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: 'Xphere — The AI Operations Platform',
    description:
      'Centralize AI assistants, automate client workflows, and manage every interaction from one powerful dashboard.',
    url: SITE_URL,
    siteName: 'Xphere',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Xphere — The AI Operations Platform',
    description:
      'Centralize AI assistants, automate client workflows, and manage every interaction from one powerful dashboard.',
  },
  keywords: ['AI operations', 'agency platform', 'AI assistants', 'workflow automation', 'CRM', 'multi-channel inbox'],
  alternates: { canonical: SITE_URL },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Xphere',
      url: SITE_URL,
      description: 'The AI Operations Platform for Modern Agencies',
    },
    {
      '@type': 'WebSite',
      url: SITE_URL,
      name: 'Xphere',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE_URL}/login`,
      },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Xphere',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'AI Operations Platform — centralize AI assistants, automate client workflows, manage voice, chat, SMS, and WhatsApp in one dashboard.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      url: SITE_URL,
    },
  ],
}

export default async function RootPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingPage />
    </>
  )
}
