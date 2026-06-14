'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, BrainCircuit, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSubSidebar } from '@/components/layout/sub-sidebar'

const ITEMS = [
  { href: '/admin/settings',       label: 'Overview',      icon: BarChart3,     exact: true },
  { href: '/admin/settings/ai',    label: 'AI Provider',   icon: BrainCircuit               },
  { href: '/admin/settings/email', label: 'Email',         icon: Mail                       },
]

export function AdminSettingsSubNav() {
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-3">
      {ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
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
            <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-accent' : 'text-text-tertiary')} />
            <span className="truncate font-medium">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
