'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import {
  ChevronUp,
  LogOut,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  UserCog,
} from 'lucide-react'
import { NAV_ITEMS as nav, NAV_GROUPS as groups } from './nav-items'

import { createClient } from '@/lib/supabase/client'
import { APP_NAME } from '@/lib/config'
import { XphereOrb } from '@/components/xphere-orb'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarContext, useSidebarState } from './sidebar-context'

function getInitials(user: User): string {
  const fullName = user.user_metadata?.full_name as string | undefined
  if (fullName) {
    const words = fullName.trim().split(/\s+/)
    if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
    if (words[0]) return words[0][0].toUpperCase()
  }
  if (user.email) return user.email[0].toUpperCase()
  return 'U'
}

function truncate(text: string, n: number) {
  return text.length <= n ? text : text.slice(0, n) + '…'
}

interface SidebarProps {
  user: User
  activeOrgId: string | null
  activeOrgName: string | null
  /** Resolved brand name (org override or APP_NAME). */
  brandName?: string
  /** Optional org logo URL | replaces the default "O" mark when set. */
  logoUrl?: string | null
  isPlatformAdmin?: boolean
}

export function Sidebar({ user, activeOrgId, activeOrgName, brandName, logoUrl, isPlatformAdmin }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { collapsed, toggle } = useSidebarState()

  const displayName = truncate((user.user_metadata?.full_name as string | undefined) ?? user.email ?? '', 24)
  const email = user.email ?? ''
  const initials = getInitials(user)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'group/sidebar relative flex h-dvh shrink-0 flex-col',
        'border-r border-border-subtle bg-bg-secondary',
        'transition-[width] duration-300 ease-spring',
        collapsed ? 'w-[48px]' : 'w-[186px]',
      )}
    >
      {/* Header | brand + collapse */}
      <div className="flex h-14 items-center justify-between px-3">
        {collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggle}
                aria-label="Expand sidebar"
                className="w-full text-text-tertiary hover:text-text-primary"
              >
                <PanelLeftOpen className="h-[15px] w-[15px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" kbd="Ctrl+B">Expand</TooltipContent>
          </Tooltip>
        )}
        <Link
          href="/"
          className={cn(
            'group/logo flex items-center gap-2 px-1.5 py-1 rounded-[8px] motion-fast',
            collapsed && 'hidden',
          )}
        >
          <div className="relative h-6 w-6 transition-[filter] duration-200 group-hover/logo:drop-shadow-[0_0_8px_rgba(79,57,246,0.6)]">
            <XphereOrb size={24} />
          </div>
          {!collapsed && (
            <span className="text-[13.5px] font-semibold tracking-tight text-text-primary">
              {brandName ?? APP_NAME}
            </span>
          )}
        </Link>
        {!collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggle}
                aria-label="Collapse sidebar"
                className="text-text-tertiary hover:text-text-primary"
              >
                <PanelLeftClose className="h-[15px] w-[15px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" kbd="Ctrl+B">Collapse</TooltipContent>
          </Tooltip>
        )}
      </div>

      {collapsed && (
        <div className="px-2 pb-1">
          <Link
            href="/"
            className="group/logo flex items-center justify-center rounded-[8px] py-1 motion-fast"
          >
            <div className="relative h-6 w-6 transition-[filter] duration-200 group-hover/logo:drop-shadow-[0_0_8px_rgba(79,57,246,0.6)]">
              <XphereOrb size={24} />
            </div>
          </Link>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {groups.map((g, gIdx) => {
          const items = nav.filter((n) => n.group === g.id && (!n.adminOnly || isPlatformAdmin))
          if (items.length === 0) return null
          return (
            <div key={g.id} className={cn('flex flex-col', gIdx > 0 && 'mt-3')}>
              {!collapsed && (
                <div className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[#A5A6D6]">
                  {g.label}
                </div>
              )}
              {items.map((item) => {
                const Icon = item.icon
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href + '/')) ||
                  (item.href === '/chat' && pathname === '/widget') ||
                  (item.href === '/calls' && (
                    pathname.startsWith('/phone') ||
                    pathname.startsWith('/voice') ||
                    pathname.startsWith('/outbound') ||
                    pathname.startsWith('/assistants')
                  ))

                const link = (
                  <Link
                    href={item.href}
                    className={cn(
                      'relative flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] font-medium',
                      'motion-fast',
                      isActive
                        ? 'bg-accent-muted text-text-primary'
                        : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    {/* active indicator | left bar */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2.5px] rounded-r-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />
                    )}
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive ? 'text-accent' : 'text-text-tertiary group-hover:text-text-primary',
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                )

                return collapsed ? (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  <React.Fragment key={item.href}>{link}</React.Fragment>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Footer | user menu (org switcher moved to header) */}
      <div className="border-t border-border-subtle p-2 space-y-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left',
                'hover:bg-bg-tertiary motion-fast',
              )}
            >
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[12.5px] font-medium leading-tight text-text-primary truncate">
                      {displayName}
                    </span>
                    {email && email !== displayName && (
                      <span className="text-[10.5px] leading-tight text-text-tertiary truncate">
                        {email}
                      </span>
                    )}
                  </div>
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link href="/settings/profile">
                <UserCog className="h-4 w-4 mr-2" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link href="/settings">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}

export { SidebarContext }
