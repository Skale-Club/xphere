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
const CAPI_TAB = { label: 'CAPI', href: '/ads/capi', value: 'capi' }
const CHANGES_TAB = { label: 'Changes', href: '/ads/changes', value: 'changes' }

export function AdsPlatformSwitcher({ pendingChangesCount = 0 }: { pendingChangesCount?: number }) {
  const pathname = usePathname()

  const activeValue = pathname.startsWith('/ads/google')
    ? 'google'
    : pathname.startsWith('/ads/journey')
    ? 'journey'
    : pathname.startsWith('/ads/capi')
    ? 'capi'
    : pathname.startsWith('/ads/changes')
    ? 'changes'
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
          <Link
            href={CAPI_TAB.href}
            className={tabClass(CAPI_TAB.value === activeValue)}
          >
            {CAPI_TAB.label}
          </Link>
          <Link
            href={CHANGES_TAB.href}
            className={cn(tabClass(CHANGES_TAB.value === activeValue), 'relative')}
          >
            {CHANGES_TAB.label}
            {pendingChangesCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
                {pendingChangesCount > 99 ? '99+' : pendingChangesCount}
              </span>
            )}
          </Link>
        </div>

        {activeValue !== 'journey' && activeValue !== 'changes' && (
          <ManageAccountsButton platform={activeValue as 'meta' | 'google'} />
        )}
      </div>
    </div>
  )
}
