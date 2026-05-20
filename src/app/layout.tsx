import type { Metadata } from 'next'
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
// paint — skip preloading to stop the "preloaded but not used" console warning.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
  preload: false,
})

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
          <Toaster
            richColors
            closeButton
            position="bottom-right"
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
