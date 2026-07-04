import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing/landing-page'
import { getLandingPublicConfig } from '@/lib/landing/public-config'
import { getFaviconUrl } from '@/lib/seo'
import { getSiteOrigin } from '@/lib/site-url'
import { getUser } from '@/lib/supabase/server'

const SITE_URL = getSiteOrigin()

export const metadata: Metadata = {
  title: 'Login',
  description: 'Sign in to your Xphere workspace.',
  alternates: { canonical: `${SITE_URL}/login` },
}

export default async function LoginPage() {
  const [faviconUrl, landing, user] = await Promise.all([
    getFaviconUrl(),
    getLandingPublicConfig(),
    getUser(),
  ])

  return (
    <LandingPage
      initialAuth="login"
      faviconUrl={faviconUrl}
      ctaImageUrl={landing.ctaImageUrl}
      scrollImages={landing.scrollImages}
      isAuthenticated={Boolean(user)}
      demoEnabled={Boolean(process.env.DEMO_ORG_ID)}
    />
  )
}
