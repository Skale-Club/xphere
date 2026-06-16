'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bot,
  Phone,
  PhoneCall,
  Route,
  Smartphone,
  type LucideIcon,
} from 'lucide-react'

import { useSubSidebar } from '@/components/layout/sub-sidebar'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  isActive: (pathname: string) => boolean
}

interface NavSection {
  heading: string
  items: NavItem[]
}

const SUBROUTES = [
  '/calls/assistants',
  '/calls/campaigns',
  '/calls/my-phone',
  '/calls/phone-numbers',
  '/calls/routing',
  '/calls/settings',
] as const

function isTimelineActive(pathname: string): boolean {
  if (pathname === '/calls') return true
  if (SUBROUTES.some((s) => pathname === s || pathname.startsWith(s + '/'))) return false
  return pathname.startsWith('/calls/')
}

const SECTIONS: NavSection[] = [
  {
    heading: 'Voice',
    items: [
      { href: '/calls', label: 'Timeline', icon: PhoneCall, isActive: isTimelineActive },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      {
        href: '/calls/phone-numbers',
        label: 'Phone Numbers',
        icon: Phone,
        isActive: (pathname) =>
          pathname === '/calls/phone-numbers' || pathname.startsWith('/calls/phone-numbers/'),
      },
      {
        href: '/calls/routing',
        label: 'Call Routing',
        icon: Route,
        isActive: (pathname) => pathname === '/calls/routing',
      },
      {
        href: '/calls/assistants',
        label: 'Connected Assistants',
        icon: Bot,
        isActive: (pathname) =>
          pathname === '/calls/assistants' || pathname.startsWith('/calls/assistants/'),
      },
    ],
  },
  {
    heading: 'Personal',
    items: [
      {
        href: '/calls/my-phone',
        label: 'My Phone',
        icon: Smartphone,
        isActive: (pathname) => pathname === '/calls/my-phone',
      },
    ],
  },
]

export function CallsSubNav() {
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
      {SECTIONS.map((section) => (
        <div key={section.heading}>
          <div className="mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
            {section.heading}
          </div>
          <div className="flex flex-col gap-px">
            {section.items.map((item) => {
              const Icon = item.icon
              const isActive = item.isActive(pathname)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[12.5px] transition-colors',
                    isActive
                      ? 'bg-accent/10 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-[60%] w-[2.5px] -translate-y-1/2 rounded-r-full bg-accent" />
                  )}
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isActive ? 'text-accent' : 'text-text-tertiary',
                    )}
                  />
                  <span className="truncate font-medium">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
