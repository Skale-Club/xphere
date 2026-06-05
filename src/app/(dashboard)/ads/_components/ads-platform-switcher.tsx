'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ManageAccountsButton } from './manage-accounts-button'

const PLATFORM_TABS = [
  { label: 'Meta Ads', href: '/ads', value: 'meta' },
  { label: 'Google Ads', href: '/ads/google', value: 'google' },
]

const JOURNEY_TAB = { label: 'Journey', href: '/ads/journey', value: 'journey' }

export function AdsPlatformSwitcher() {
  const pathname = usePathname()

  const activeValue = pathname.startsWith('/ads/google')
    ? 'google'
    : pathname.startsWith('/ads/journey')
    ? 'journey'
    : 'meta'

  function tabClass(isActive: boolean) {
    return cn(
      'flex h-7 items-center rounded-[6px] px-3 text-[12.5px] font-medium transition-all',
      isActive
        ? 'bg-bg-primary text-text-primary shadow-sm'
        : 'text-text-secondary hover:text-text-primary',
    )
  }

  return (
    <div className="flex w-full items-center justify-between gap-2">
      {/* Ad platforms — grouped on the left */}
      <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
        {PLATFORM_TABS.map((tab) => (
          <Link key={tab.value} href={tab.href} className={tabClass(tab.value === activeValue)}>
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Journey + Manage accounts — on the right */}
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
          <Link
            href={JOURNEY_TAB.href}
            className={tabClass(JOURNEY_TAB.value === activeValue)}
          >
            {JOURNEY_TAB.label}
          </Link>
        </div>

        {activeValue !== 'journey' && (
          <ManageAccountsButton platform={activeValue as 'meta' | 'google'} />
        )}
      </div>
    </div>
  )
}
