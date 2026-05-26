import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/components/theme-provider'
import { APP_NAME } from '@/lib/config'
import { getFaviconUrl } from '@/lib/seo'
import './globals.css'

// Only preload the Inter weights actually used in the dashboard shell on first
// paint. The browser will lazy-fetch any additional weights as needed.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
})

// JetBrains Mono is only used in code/log views and rarely visible on first
// paint | skip preloading to stop the "preloaded but not used" console warning.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
  preload: false,
})

// SEED-040: native-feel viewport for mobile.
// - viewportFit: 'cover' lets us paint behind the iPhone notch / Dynamic Island
//   (used together with env(safe-area-inset-*) in the chat shell).
// - maximumScale 5 keeps accessibility zoom working but discourages accidental
//   pinch-zoom inside the inbox where it would fight horizontal swipes.
// - themeColor matches the dashboard surface in both modes so the iOS status
//   bar blends with the app chrome.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#0A0A0B' },
    { media: '(prefers-color-scheme: light)', color: '#FCFCFD' },
  ],
}

export async function generateMetadata(): Promise<Metadata> {
  const faviconUrl = await getFaviconUrl()
  return {
    title: APP_NAME,
    description: 'AI Operations Platform',
    applicationName: APP_NAME,
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: APP_NAME,
    },
    other: {
      'mobile-web-app-capable': 'yes',
    },
    icons: {
      icon: faviconUrl ? [{ url: faviconUrl }] : [{ url: '/xphere-icon.svg', type: 'image/svg+xml' }],
      ...(faviconUrl && { shortcut: faviconUrl }),
      apple: '/api/pwa/icons/180',
    },
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={300}>
            {children}
          </TooltipProvider>
          {/*
            SEED-040: position="top-center" works on both desktop and mobile.
            On mobile, bottom-right would collide with the chat composer when
            the virtual keyboard is open. Top-center keeps toasts visible above
            the chat header (the header has its own pt-safe padding).
          */}
          <Toaster
            richColors
            closeButton
            position="top-center"
            theme="system"
            duration={4000}
            visibleToasts={5}
            toastOptions={{
              style: {
                fontFamily: 'var(--font-sans)',
                borderRadius: '10px',
              },
              className: 'group',
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
