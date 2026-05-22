'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, ShieldCheck, Menu, Command } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { AppBreadcrumb } from './app-breadcrumb'
import { OrgSwitcher } from './org-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { useCommandPalette } from '@/components/command-palette'
import { DialPadHeaderButton } from '@/components/calls/dial-pad-header-button'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { cn } from '@/lib/utils'

interface TopBarProps {
  activeOrgId: string | null
  activeOrgName: string | null
  isPlatformAdmin: boolean
  userId: string | null
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
            'hover:border-border hover:bg-bg-tertiary hover:text-text-secondary',
            'motion-fast',
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

export function TopBar({ activeOrgId, activeOrgName, isPlatformAdmin, userId }: TopBarProps) {
  const { setOpen } = useCommandPalette()
  const [mobileOpen, setMobileOpen] = useState(false)

  function openSearch() {
    setOpen(true)
    setMobileOpen(false)
  }

  return (
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
        <DialPadHeaderButton />
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
                  'text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10',
                  'border border-amber-500/20 hover:border-amber-500/40',
                )}
              >
                <ShieldCheck className="h-[15px] w-[15px]" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom">Super Admin</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Mobile: hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className={cn(
          'sm:hidden inline-flex h-8 w-8 items-center justify-center rounded-[8px]',
          'border border-border-subtle bg-bg-secondary text-text-tertiary',
          'hover:bg-bg-tertiary hover:text-text-secondary motion-fast',
        )}
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Mobile Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="w-72 flex flex-col gap-0 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>

          {/* Org switcher */}
          <div className="px-4 py-4 border-b border-border-subtle">
            <OrgSwitcher currentOrgId={activeOrgId} currentOrgName={activeOrgName} />
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-border-subtle">
            <button
              onClick={openSearch}
              className={cn(
                'w-full flex items-center gap-3 rounded-[8px] border border-border-subtle bg-bg-secondary',
                'px-3 py-2.5 text-sm text-text-tertiary',
                'hover:border-border hover:bg-bg-tertiary hover:text-text-secondary motion-fast',
              )}
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Search</span>
              <kbd className="inline-flex items-center gap-px text-text-tertiary border border-border-subtle rounded-[4px] px-2 py-0.5 bg-bg-primary leading-none">
                <Command className="h-[11px] w-[11px]" />
                <span className="font-mono text-[11px]">K</span>
              </kbd>
            </button>
          </div>

          {/* Icon actions */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
            <DialPadHeaderButton />
            <NotificationBell userId={userId} />
            <ThemeToggle />
            {isPlatformAdmin && (
              <Link
                href="/admin"
                aria-label="Super Admin"
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-[8px] motion-fast',
                  'text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10',
                  'border border-amber-500/20 hover:border-amber-500/40',
                )}
              >
                <ShieldCheck className="h-[15px] w-[15px]" />
              </Link>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  )
}
