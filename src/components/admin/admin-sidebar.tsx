'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ShieldCheck,
  Building2,
  Settings,
  Search,
  LayoutDashboard,
  Activity,
  Image as ImageIcon,
  BarChart3,
  GitMerge,
  ScrollText,
  KeyRound,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

const navItems = [
  { href: '/admin',          label: 'Overview',       icon: LayoutDashboard, exact: true },
  { href: '/admin/orgs',     label: 'Organizations',  icon: Building2 },
  { href: '/admin/roles',    label: 'Roles & Permissions', icon: KeyRound },
  { href: '/admin/ads-playbook', label: 'Ads Playbook',   icon: BookOpen },
  { href: '/admin/contacts/conflicts', label: 'Conflicts', icon: GitMerge },
  { href: '/admin/activity', label: 'Activity',       icon: Activity },
  { href: '/admin/logs',     label: 'Logs',           icon: ScrollText },
  { href: '/admin/settings', label: 'Settings',       icon: Settings },
  { href: '/admin/seo',      label: 'SEO & Branding', icon: Search },
  { href: '/admin/landing',  label: 'Landing Page',   icon: ImageIcon },
  { href: '/admin/traffic',  label: 'Traffic',        icon: BarChart3 },
]

const STORAGE_KEY = 'admin:sidebar:collapsed'

export function AdminSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored !== null) setCollapsed(stored === '1')
    } catch {}
  }, [])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  return (
    <TooltipProvider delayDuration={200}>
    <aside
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col',
        'border-r border-border-subtle bg-bg-secondary',
        'transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        collapsed ? 'w-[48px]' : 'w-[176px]',
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between px-2 border-b border-border-subtle bg-fuchsia-500/5">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggle}
                aria-label="Expand sidebar"
                className="w-full text-fuchsia-400/70 hover:text-fuchsia-300"
              >
                <PanelLeftOpen className="h-[15px] w-[15px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <div className="flex items-center gap-2 px-1">
              <ShieldCheck className="h-4 w-4 text-fuchsia-500 dark:text-fuchsia-400 shrink-0" />
              <span className="font-semibold text-[13px] text-text-primary tracking-tight truncate">Admin</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggle}
                  aria-label="Collapse sidebar"
                  className="shrink-0 text-text-tertiary hover:text-text-primary"
                >
                  <PanelLeftClose className="h-[15px] w-[15px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Collapse</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon, exact }) => {
          const isActive = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(href + '/')

          if (collapsed) {
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      'relative flex h-8 w-8 mx-auto items-center justify-center rounded-[7px] transition-colors duration-100',
                      isActive
                        ? 'bg-accent-muted text-text-primary'
                        : 'text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary',
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2.5px] rounded-r-full bg-accent" />
                    )}
                    <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-accent' : '')} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            )
          }

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-2 px-2.5 py-2 rounded-[7px] text-[13px] transition-colors duration-100',
                isActive
                  ? 'bg-accent-muted text-text-primary'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2.5px] rounded-r-full bg-accent" />
              )}
              <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-accent' : 'text-text-tertiary')} />
              <span className="truncate">{label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
    </TooltipProvider>
  )
}
