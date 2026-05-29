'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const PLATFORMS = [
  { label: 'Meta Ads', href: '/ads', value: 'meta' },
  { label: 'Google Ads', href: '#', value: 'google', comingSoon: true },
]

export function AdsPlatformSwitcher() {
  const pathname = usePathname()
  const isMetaActive = !PLATFORMS.slice(1).some((p) => pathname.startsWith(p.href))

  return (
    <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
      {PLATFORMS.map((platform) => {
        const isActive = platform.value === 'meta' ? isMetaActive : false

        if (platform.comingSoon) {
          return (
            <span
              key={platform.value}
              className={cn(
                'relative flex h-7 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium',
                'text-text-tertiary cursor-not-allowed select-none',
              )}
            >
              {platform.label}
              <span className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-bg-secondary text-text-tertiary">
                Em breve
              </span>
            </span>
          )
        }

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
