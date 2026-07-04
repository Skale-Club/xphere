import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing/landing-page'
import { getLandingPublicConfig } from '@/lib/landing/public-config'
import { getFaviconUrl } from '@/lib/seo'
import { getSiteOrigin } from '@/lib/site-url'
import { getUser } from '@/lib/supabase/server'

const SITE_URL = getSiteOrigin()

export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create your Xphere account.',
  alternates: { canonical: `${SITE_URL}/signup` },
}

export default async function SignupPage() {
  const [faviconUrl, landing, user] = await Promise.all([
    getFaviconUrl(),
    getLandingPublicConfig(),
    getUser(),
  ])

  return (
    <LandingPage
      initialAuth="signup"
      faviconUrl={faviconUrl}
      ctaImageUrl={landing.ctaImageUrl}
      scrollImages={landing.scrollImages}
      isAuthenticated={Boolean(user)}
      demoEnabled={Boolean(process.env.DEMO_ORG_ID)}
    />
  )
}
