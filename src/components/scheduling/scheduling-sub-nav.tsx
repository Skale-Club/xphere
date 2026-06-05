'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen,
  CalendarDays,
  CalendarCheck2,
  Clock,
  Link2,
  Settings2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSubSidebar } from '@/components/layout/sub-sidebar-context'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
}

interface NavSection {
  heading: string | null
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    heading: null,
    items: [
      { href: '/scheduling', label: 'Event Types', icon: CalendarDays, exact: true },
      { href: '/scheduling/bookings', label: 'Bookings', icon: BookOpen },
      { href: '/scheduling/calendar', label: 'Calendar', icon: CalendarCheck2 },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { href: '/scheduling/availability', label: 'Availability', icon: Clock },
      { href: '/scheduling/preferences', label: 'Preferences', icon: Settings2 },
      { href: '/scheduling/connections', label: 'Connections', icon: Link2 },
    ],
  },
]


export function SchedulingSubNav() {
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
      {SECTIONS.map((section, index) => (
        <div key={section.heading ?? index}>
          {section.heading && (
            <div className="mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
              {section.heading}
            </div>
          )}
          <div className="flex flex-col gap-px">
            {section.items.map((item) => {
              const Icon = item.icon
              const isActive = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + '/')
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
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-[60%] w-[2.5px] rounded-r-full bg-accent" />
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
