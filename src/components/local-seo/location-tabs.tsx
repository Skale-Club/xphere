'use client'

import Link from 'next/link'

import { usePathname } from '@/lib/org/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Rankings', segment: '' },
  { label: 'Trends', segment: 'trends' },
  { label: 'Competitors', segment: 'competitors' },
  { label: 'Reviews', segment: 'reviews' },
  { label: 'Posts', segment: 'posts' },
  { label: 'Profile', segment: 'profile' },
  { label: 'Audit', segment: 'audit' },
  { label: 'Settings', segment: 'settings' },
]

export function LocationTabs({ locationId }: { locationId: string }) {
  const pathname = usePathname()
  const base = `/local-seo/${locationId}`
  const active = pathname.slice(base.length).split('/').filter(Boolean)[0] ?? ''

  return (
    <nav className="flex items-center gap-1 overflow-x-auto rounded-lg bg-bg-tertiary p-1">
      {TABS.map((t) => (
        <Link
          key={t.label}
          href={t.segment ? `${base}/${t.segment}` : base}
          className={cn(
            'flex h-7 shrink-0 items-center rounded-[6px] px-3 text-[12.5px] font-medium transition-all',
            active === t.segment
              ? 'bg-bg-primary text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
