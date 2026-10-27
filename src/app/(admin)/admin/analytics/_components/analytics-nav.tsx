'use client'

import Link from 'next/link'
import { usePathname } from '@/lib/org/navigation'
import { cn } from '@/lib/utils'

const items = [
  { href: '/admin/analytics', label: 'Traffic overview', exact: true },
  { href: '/admin/analytics/game', label: 'Game analytics', exact: false },
]

/** Two-link switcher between the platform traffic overview and the global game panels. */
export function AnalyticsNav() {
  const pathname = usePathname()
  return (
    <nav className="mb-6 inline-flex h-9 items-center rounded-md bg-muted p-1 text-muted-foreground" aria-label="Analytics sections">
      {items.map(({ href, label, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center rounded-sm px-3 py-1 text-sm font-medium transition-all',
              active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
