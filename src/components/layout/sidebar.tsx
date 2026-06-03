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
import { useUnreadCount } from '@/hooks/use-unread-count'

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
  /** Public read-only demo session | hides settings/credential entry points. */
  isDemo?: boolean
  /**
   * RBAC permission keys the user holds. `null`/undefined = unrestricted (Owner,
   * platform admin, or an org with no RBAC config yet) → all items shown.
   */
  navPermissions?: string[] | null
}

/**
 * Inner brand + nav + user-menu markup, shared by every rendering of the
 * sidebar (desktop in-flow column, the mobile icon rail, and the mobile
 * slide-in overlay). Keeping it in one place means the three surfaces never
 * drift apart.
 */
interface SidebarBodyProps {
  collapsed: boolean
  /** Header panel button — collapse/expand in place, or open/close the overlay. */
  onToggle: () => void
  /** Show the Ctrl+B hint on the panel button (desktop only). */
  showShortcut?: boolean
  /** Called after a nav link is followed — used to dismiss the mobile overlay. */
  onNavigate?: () => void
  user: User
  userId?: string | null
  displayName: string
  email: string
  initials: string
  brandName?: string
  isPlatformAdmin?: boolean
  isDemo?: boolean
  navPermissions?: string[] | null
  pathname: string
  onSignOut: () => void
}

function SidebarBody({
  collapsed,
  onToggle,
  showShortcut = false,
  onNavigate,
  userId,
  displayName,
  email,
  initials,
  brandName,
  isPlatformAdmin,
  isDemo,
  navPermissions,
  pathname,
  onSignOut,
}: SidebarBodyProps) {
  const chatUnreadCount = useUnreadCount(userId)
  return (
    <>
      {/* Header | brand + collapse */}
      <div className="flex h-14 items-center justify-between px-3">
        {collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggle}
                aria-label="Expand sidebar"
                className="w-full text-text-tertiary hover:text-text-primary"
              >
                <PanelLeftOpen className="h-[15px] w-[15px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" kbd={showShortcut ? 'Ctrl+B' : undefined}>Expand</TooltipContent>
          </Tooltip>
        )}
        <Link
          href="/"
          onClick={onNavigate}
          className={cn(
            'group/logo flex items-center gap-2 px-1.5 py-1 rounded-[8px] transition-colors duration-100 ease-out',
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
                onClick={onToggle}
                aria-label="Collapse sidebar"
                className="text-text-tertiary hover:text-text-primary"
              >
                <PanelLeftClose className="h-[15px] w-[15px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" kbd={showShortcut ? 'Ctrl+B' : undefined}>Collapse</TooltipContent>
          </Tooltip>
        )}
      </div>

      {collapsed && (
        <div className="px-2 pb-1">
          <Link
            href="/"
            onClick={onNavigate}
            className="group/logo flex items-center justify-center rounded-[8px] py-1 transition-colors duration-100 ease-out"
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
          const items = nav.filter(
            (n) =>
              n.group === g.id &&
              (!n.adminOnly || isPlatformAdmin) &&
              // navPermissions == null → unrestricted; otherwise the user must
              // hold the item's permission key (items without a key stay visible).
              (navPermissions == null || !n.permission || navPermissions.includes(n.permission)),
          )
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
                    onClick={onNavigate}
                    className={cn(
                      'relative flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] font-medium',
                      'transition-colors duration-100 ease-out',
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
                    {!collapsed && item.href === '/chat' && chatUnreadCount > 0 && (
                      <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white leading-none">
                        {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                      </span>
                    )}
                    {collapsed && item.href === '/chat' && chatUnreadCount > 0 && (
                      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                    )}
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
                'hover:bg-bg-tertiary transition-colors duration-100 ease-out',
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
            {!isDemo && (
              <>
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link href="/settings/profile" onClick={onNavigate}>
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={onSignOut} className="cursor-pointer">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}

export function Sidebar({ user, activeOrgId: _activeOrgId, activeOrgName: _activeOrgName, brandName, logoUrl: _logoUrl, isPlatformAdmin, isDemo, navPermissions }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebarState()

  const displayName = truncate((user.user_metadata?.full_name as string | undefined) ?? user.email ?? '', 24)
  const email = user.email ?? ''
  const initials = getInitials(user)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const closeOverlay = React.useCallback(() => setMobileOpen(false), [setMobileOpen])

  // Dismiss the overlay whenever the route changes (covers programmatic nav).
  React.useEffect(() => {
    setMobileOpen(false)
  }, [pathname, setMobileOpen])

  // Close on Escape and lock body scroll while the overlay is open.
  React.useEffect(() => {
    if (!mobileOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [mobileOpen, setMobileOpen])

  // Auto-dismiss if the viewport grows to desktop where the overlay never shows.
  React.useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)')
    function onChange() {
      if (mql.matches) setMobileOpen(false)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [setMobileOpen])

  const bodyProps = {
    user,
    userId: user.id,
    displayName,
    email,
    initials,
    brandName,
    isPlatformAdmin,
    isDemo,
    navPermissions,
    pathname,
    onSignOut: handleSignOut,
  }

  return (
    <>
      {/* Desktop | in-flow collapsible column (lg and up) */}
      <aside
        data-collapsed={collapsed}
        className={cn(
          'group/sidebar relative hidden h-dvh shrink-0 flex-col lg:flex',
          'border-r border-border-subtle bg-bg-secondary',
          'transition-[width] duration-300 ease-spring',
          collapsed ? 'w-[48px]' : 'w-[186px]',
        )}
      >
        <SidebarBody {...bodyProps} collapsed={collapsed} onToggle={toggle} showShortcut />
      </aside>

      {/* Tablet / phone | in-flow 48px icon rail. The expand button opens the
          full sidebar as an overlay rather than widening in place. */}
      <aside
        className={cn(
          'group/sidebar relative flex h-dvh w-[48px] shrink-0 flex-col lg:hidden',
          'border-r border-border-subtle bg-bg-secondary',
        )}
      >
        <SidebarBody
          {...bodyProps}
          collapsed
          onToggle={() => setMobileOpen(true)}
        />
      </aside>

      {/* Tablet / phone | slide-in overlay with the expanded sidebar + backdrop */}
      <div className="lg:hidden" aria-hidden={!mobileOpen}>
        {/* Backdrop */}
        <div
          onClick={closeOverlay}
          className={cn(
            'fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]',
            'transition-opacity duration-300',
            mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />
        {/* Drawer */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex h-dvh w-[240px] flex-col',
            'border-r border-border-subtle bg-bg-secondary shadow-2xl shadow-black/40',
            'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <SidebarBody
            {...bodyProps}
            collapsed={false}
            onToggle={closeOverlay}
            onNavigate={closeOverlay}
          />
        </aside>
      </div>
    </>
  )
}

export { SidebarContext }
