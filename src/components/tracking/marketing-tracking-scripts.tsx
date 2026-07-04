'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'
import type { TrackingConfig } from '@/lib/tracking/config'

// Only fire GTM/Pixel on public marketing pages — never inside the
// authenticated dashboard or the super-admin console.
const MARKETING_PATHS = new Set(['/', '/login', '/signup', '/privacy', '/terms', '/data-deletion'])

export function MarketingTrackingScripts({ tracking }: { tracking: TrackingConfig | null }) {
  const pathname = usePathname()
  if (!MARKETING_PATHS.has(pathname)) return null

  return (
    <>
      {tracking?.gtmContainerId && (
        <>
          <Script id="gtm-base" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${tracking.gtmContainerId}');`}
          </Script>
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${tracking.gtmContainerId}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        </>
      )}
      {tracking?.facebookPixelId && (
        <Script id="fb-pixel-base" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${tracking.facebookPixelId}');fbq('track','PageView');`}
        </Script>
      )}
    </>
  )
}
