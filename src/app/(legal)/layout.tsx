import Link from 'next/link'
import { APP_NAME } from '@/lib/config'

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-hover text-sm font-bold text-white">
              {APP_NAME.charAt(0)}
            </div>
            <span className="text-[15px] font-semibold">{APP_NAME}</span>
          </Link>
          <nav className="flex items-center gap-4 text-[13px] text-text-secondary">
            <Link href="/privacy" className="hover:text-text-primary">Privacy</Link>
            <Link href="/terms" className="hover:text-text-primary">Terms</Link>
            <Link href="/data-deletion" className="hover:text-text-primary">Data deletion</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <article
          className="space-y-5 text-[14px] leading-relaxed text-text-secondary
            [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-text-primary [&_h1]:mb-2
            [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text-primary
            [&_a]:text-accent [&_a]:underline [&_a:hover]:opacity-80
            [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1
            [&_strong]:text-text-primary"
        >
          {children}
        </article>
      </main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto max-w-3xl px-6 py-6 text-[12px] text-text-tertiary">
          © {APP_NAME}. Operated by Skale Club.
        </div>
      </footer>
    </div>
  )
}
