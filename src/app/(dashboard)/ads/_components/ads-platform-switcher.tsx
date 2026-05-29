'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Meta Ads', href: '/ads', value: 'meta' },
  { label: 'Google Ads', href: '/ads/google', value: 'google' },
  { label: 'Jornada', href: '/ads/journey', value: 'journey' },
]

export function AdsPlatformSwitcher() {
  const pathname = usePathname()

  const activeValue = pathname.startsWith('/ads/google')
    ? 'google'
    : pathname.startsWith('/ads/journey')
    ? 'journey'
    : 'meta'

  return (
    <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
      {TABS.map((tab) => {
        const isActive = tab.value === activeValue
        return (
          <Link
            key={tab.value}
            href={tab.href}
            className={cn(
              'flex h-7 items-center rounded-[6px] px-3 text-[12.5px] font-medium transition-all',
              isActive
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
