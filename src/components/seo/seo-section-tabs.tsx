'use client'

import Link from 'next/link'

import { usePathname } from '@/lib/org/navigation'
import { cn } from '@/lib/utils'

type Tab = { key: string; label: string; href: string }

function tabClass(isActive: boolean) {
  return cn(
    'flex h-7 shrink-0 items-center rounded-[6px] px-3 text-[12.5px] font-medium transition-all',
    isActive ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
  )
}

/** Website · Local · Reviews on the left, Reports on the right — same pills as the Ads switcher. */
export function SeoSectionTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname()
  const isActive = (t: Tab) => pathname === t.href || pathname.startsWith(t.href + '/')
  const main = tabs.filter((t) => t.key !== 'reports')
  const reports = tabs.find((t) => t.key === 'reports')

  return (
    <nav className="flex w-full items-center justify-between gap-2" aria-label="SEO sections">
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-bg-tertiary p-1">
        {main.map((t) => (
          <Link key={t.key} href={t.href} className={tabClass(isActive(t))} aria-current={isActive(t) ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
      </div>
      {reports && (
        <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
          <Link href={reports.href} className={tabClass(isActive(reports))} aria-current={isActive(reports) ? 'page' : undefined}>
            {reports.label}
          </Link>
        </div>
      )}
    </nav>
  )
}
