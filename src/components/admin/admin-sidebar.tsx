'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShieldCheck, Building2, Settings, Search, LayoutDashboard, Activity, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/admin',          label: 'Overview',       icon: LayoutDashboard, exact: true },
  { href: '/admin/orgs',     label: 'Organizations',  icon: Building2 },
  { href: '/admin/activity', label: 'Activity',       icon: Activity },
  { href: '/admin/settings', label: 'Settings',       icon: Settings },
  { href: '/admin/seo',      label: 'SEO & Branding', icon: Search },
  { href: '/admin/landing',  label: 'Landing Page',   icon: ImageIcon },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-60 shrink-0 bg-bg-secondary border-r border-border-subtle flex flex-col min-h-screen">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-border-subtle bg-amber-500/5">
        <ShieldCheck className="h-5 w-5 text-amber-500 dark:text-amber-400 shrink-0" />
        <span className="font-semibold text-sm text-text-primary tracking-tight">Xphere Admin</span>
      </div>

      <nav className="flex-1 p-3 flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon, exact }) => {
          const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-2 px-3 py-2 rounded-[7px] text-sm transition-colors duration-100',
                isActive
                  ? 'bg-accent-muted text-text-primary'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2.5px] rounded-r-full bg-accent" />
              )}
              <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-accent' : 'text-text-tertiary')} />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
