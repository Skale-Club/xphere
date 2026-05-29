'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const PLATFORMS = [
  { label: 'Meta Ads', href: '/ads', value: 'meta' },
  { label: 'Google Ads', href: '/ads/google', value: 'google' },
]

export function AdsPlatformSwitcher() {
  const pathname = usePathname()

  // /ads/google/* → google active; anything else → meta active
  const activeValue = pathname.startsWith('/ads/google') ? 'google' : 'meta'

  return (
    <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
      {PLATFORMS.map((platform) => {
        const isActive = platform.value === activeValue
        return (
          <Link
            key={platform.value}
            href={platform.href}
            className={cn(
              'flex h-7 items-center rounded-[6px] px-3 text-[12.5px] font-medium transition-all',
              isActive
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {platform.label}
          </Link>
        )
      })}
    </div>
  )
}
