import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { unstable_cache } from 'next/cache'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/components/theme-provider'
import { APP_NAME } from '@/lib/config'
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
// paint — skip preloading to stop the "preloaded but not used" console warning.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
  preload: false,
})

const getFaviconUrl = unstable_cache(
  async (): Promise<string | null> => {
    try {
      const { createServiceRoleClient } = await import('@/lib/supabase/admin')
      const admin = createServiceRoleClient()
      const { data } = await admin
        .from('seo_config')
        .select('favicon_url')
        .limit(1)
        .single()
      return (data as { favicon_url?: string | null } | null)?.favicon_url ?? null
    } catch {
      return null
    }
  },
  ['seo-favicon'],
  { revalidate: 3600 }
)

export async function generateMetadata(): Promise<Metadata> {
  const faviconUrl = await getFaviconUrl()
  return {
    title: APP_NAME,
    description: 'AI Operations Platform',
    ...(faviconUrl && {
      icons: {
        icon: [{ url: faviconUrl }],
        shortcut: faviconUrl,
        apple: faviconUrl,
      },
    }),
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${inter.variable} ${mono.variable}`}>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={300}>
            {children}
          </TooltipProvider>
          <Toaster
            richColors
            closeButton
            position="bottom-right"
            theme="dark"
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
