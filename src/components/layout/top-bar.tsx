'use client'

import * as React from 'react'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, ShieldCheck, Menu, Command, X, Phone, Bell, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AppBreadcrumb } from './app-breadcrumb'
import { OrgSwitcher } from './org-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { useCommandPalette } from '@/components/command-palette'
import { DialPadHeaderButton } from '@/components/calls/dial-pad-header-button'
import { toggleDialPad } from '@/components/calls/dial-pad-context'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { cn } from '@/lib/utils'

interface TopBarProps {
  activeOrgId: string | null
  activeOrgName: string | null
  isPlatformAdmin: boolean
  userId: string | null
  /** True when the org has at least one active twilio_phone_numbers row.
   * Used to hide the dial-pad header button while there's nothing to dial from. */
  hasPhoneNumber: boolean
}

function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'inline-flex items-center gap-2 rounded-[8px] border border-border-subtle bg-bg-secondary',
            'px-2.5 py-1.5 text-[12.5px] text-text-tertiary',
            'hover:border-border hover:bg-bg-tertiary hover:text-text-secondary motion-fast',
          )}
          aria-label="Open command palette"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Search</span>
          <kbd className="ml-2 hidden md:inline-flex items-center gap-px text-text-tertiary border border-border-subtle rounded-[4px] px-2 py-0.5 bg-bg-primary leading-none">
            <Command className="h-[11px] w-[11px]" />
            <span className="font-mono text-[11px]">K</span>
          </kbd>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" kbd="⌘K">Command palette</TooltipContent>
    </Tooltip>
  )
}

function MobileMenu({
  open,
  onClose,
  activeOrgId,
  activeOrgName,
  isPlatformAdmin,
  userId,
  onOpenSearch,
}: {
  open: boolean
  onClose: () => void
  activeOrgId: string | null
  activeOrgName: string | null
  isPlatformAdmin: boolean
  userId: string | null
  onOpenSearch: () => void
}) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  useEffect(() => setMounted(true), [])
  const isDark = mounted ? theme === 'dark' : true

  // Lock body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col bg-bg-primary sm:hidden',
        'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        open ? 'translate-y-0' : 'translate-y-full pointer-events-none',
      )}
    >
      {/* Top bar inside menu */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-5">
        <span className="text-sm font-semibold text-text-primary">Menu</span>
        <button
          onClick={onClose}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-[8px]',
            'text-text-tertiary hover:bg-bg-secondary hover:text-text-primary motion-fast',
          )}
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">

        {/* Workspace */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Workspace</p>
          <div className="rounded-[14px] border border-border-subtle bg-bg-secondary px-4 py-4">
            <OrgSwitcher currentOrgId={activeOrgId} currentOrgName={activeOrgName} />
          </div>
        </section>

        {/* Search */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Search</p>
          <button
            onClick={onOpenSearch}
            className={cn(
              'w-full flex items-center gap-3 rounded-[14px] border border-border-subtle bg-bg-secondary',
              'px-4 py-4 text-base text-text-tertiary',
              'hover:border-border hover:bg-bg-tertiary hover:text-text-secondary motion-fast',
            )}
          >
            <Search className="h-5 w-5 shrink-0 text-text-tertiary" />
            <span className="flex-1 text-left text-text-tertiary">Search anything…</span>
            <span className="text-xs font-mono text-text-tertiary border border-border-subtle rounded-[5px] px-1.5 py-0.5 bg-bg-primary">⌘K</span>
          </button>
        </section>

        {/* Quick actions */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Quick actions</p>
          <div className="grid grid-cols-3 gap-3">
            {/* Dial pad */}
            <button
              onClick={() => { toggleDialPad(); onClose() }}
              className="flex flex-col items-center justify-center gap-3 rounded-[14px] border border-border-subtle bg-bg-secondary px-3 py-6 hover:bg-bg-tertiary hover:border-border active:scale-95 transition-all duration-100"
            >
              <Phone className="h-6 w-6 text-text-secondary" />
              <span className="text-sm text-text-secondary">Dial pad</span>
            </button>

            {/* Notifications — invisible overlay triggers the popover */}
            <div className="relative flex flex-col items-center justify-center gap-3 rounded-[14px] border border-border-subtle bg-bg-secondary px-3 py-6 hover:bg-bg-tertiary hover:border-border active:scale-95 transition-all duration-100 cursor-pointer">
              <Bell className="h-6 w-6 text-text-secondary pointer-events-none" />
              <span className="text-sm text-text-secondary pointer-events-none">Notifications</span>
              <div className="absolute inset-0 opacity-0">
                <NotificationBell userId={userId} />
              </div>
            </div>

            {/* Theme */}
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="flex flex-col items-center justify-center gap-3 rounded-[14px] border border-border-subtle bg-bg-secondary px-3 py-6 hover:bg-bg-tertiary hover:border-border active:scale-95 transition-all duration-100"
            >
              {isDark
                ? <Sun className="h-6 w-6 text-text-secondary" />
                : <Moon className="h-6 w-6 text-text-secondary" />
              }
              <span className="text-sm text-text-secondary">Theme</span>
            </button>
          </div>
        </section>

        {/* Admin */}
        {isPlatformAdmin && (
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Admin</p>
            <Link
              href="/admin"
              onClick={onClose}
              className={cn(
                'flex items-center justify-between rounded-[14px] px-4 py-4',
                'border border-fuchsia-500/25 bg-fuchsia-500/6',
                'hover:bg-fuchsia-500/12 motion-fast',
              )}
            >
              <div>
                <p className="text-base font-medium text-fuchsia-300">Super Admin</p>
                <p className="text-sm text-fuchsia-400/60 mt-0.5">Platform management</p>
              </div>
              <ShieldCheck className="h-6 w-6 text-fuchsia-400 shrink-0" />
            </Link>
          </section>
        )}
      </div>
    </div>
  )
}

export function TopBar({ activeOrgId, activeOrgName, isPlatformAdmin, userId, hasPhoneNumber }: TopBarProps) {
  const { setOpen } = useCommandPalette()
  const [mobileOpen, setMobileOpen] = useState(false)

  function openSearch() {
    setOpen(true)
    setMobileOpen(false)
  }

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6 lg:px-8',
          'border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md',
        )}
      >
        {/* Breadcrumb */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <AppBreadcrumb />
        </div>

        {/* Desktop actions */}
        <div className="hidden sm:flex items-center gap-1.5">
          <SearchButton onClick={openSearch} />
          {hasPhoneNumber && <DialPadHeaderButton />}
          <NotificationBell userId={userId} />
          <ThemeToggle />
          <div className="min-w-0">
            <OrgSwitcher currentOrgId={activeOrgId} currentOrgName={activeOrgName} />
          </div>
          {isPlatformAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/admin"
                  aria-label="Super Admin"
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-[8px] motion-fast',
                    'text-fuchsia-400/80 hover:text-fuchsia-300 hover:bg-fuchsia-500/10',
                    'border border-fuchsia-500/20 hover:border-fuchsia-500/40',
                  )}
                >
                  <ShieldCheck className="h-[15px] w-[15px]" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">Super Admin</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Mobile: dial pad (only when a number is connected) + hamburger */}
        <div className="sm:hidden flex items-center gap-1.5">
          {hasPhoneNumber && <DialPadHeaderButton />}
          <button
            onClick={() => setMobileOpen(true)}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-[8px]',
              'border border-border-subtle bg-bg-secondary text-text-tertiary',
              'hover:bg-bg-tertiary hover:text-text-secondary motion-fast',
            )}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </header>

      <MobileMenu
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        activeOrgId={activeOrgId}
        activeOrgName={activeOrgName}
        isPlatformAdmin={isPlatformAdmin}
        userId={userId}
        onOpenSearch={openSearch}
      />
    </>
  )
}
