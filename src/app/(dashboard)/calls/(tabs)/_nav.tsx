'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const SUBROUTES = ['/calls/campaigns', '/calls/assistants', '/calls/settings'] as const

function isTimelineActive(pathname: string): boolean {
  if (pathname === '/calls') return true
  // /calls/[id] (detail page) | not a subroute
  if (SUBROUTES.some((s) => pathname === s || pathname.startsWith(s + '/'))) return false
  return pathname.startsWith('/calls/')
}

const TABS = [
  { href: '/calls', label: 'Timeline', isActive: isTimelineActive },
  { href: '/calls/assistants', label: 'Vapi Assistants', isActive: (p: string) => p === '/calls/assistants' || p.startsWith('/calls/assistants/') },
  { href: '/calls/settings', label: 'Settings', isActive: (p: string) => p === '/calls/settings' || p.startsWith('/calls/settings/') },
]

export function CallsNav() {
  const pathname = usePathname()

  return (
    <nav className="border-b border-border">
      <div className="-mb-px flex items-center gap-6">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'inline-flex items-center py-2 text-[13px] font-medium border-b-2 transition-colors',
                active
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-primary hover:border-border-strong',
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
