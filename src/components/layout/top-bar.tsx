'use client'

import Link from 'next/link'
import { Search, ShieldCheck } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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

export function TopBar({ activeOrgId, activeOrgName, isPlatformAdmin, userId }: TopBarProps) {
  const { setOpen } = useCommandPalette()

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6 lg:px-8',
        'border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <AppBreadcrumb />
      </div>

      <div className="flex items-center gap-1.5">
        {/* Command Palette trigger */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setOpen(true)}
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
              <kbd className="ml-2 hidden md:inline-flex items-center gap-0.5 font-mono text-[10.5px] tracking-wider text-text-tertiary border border-border-subtle rounded-[4px] px-1.5 py-0.5 bg-bg-primary">
                ⌘K
              </kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" kbd="⌘K">Command palette</TooltipContent>
        </Tooltip>

        {/* Dial pad */}
        <DialPadHeaderButton />

        <NotificationBell userId={userId} />

        <ThemeToggle />

        {/* Org switcher */}
        <div className="hidden sm:block min-w-0">
          <OrgSwitcher currentOrgId={activeOrgId} currentOrgName={activeOrgName} />
        </div>

        {/* Super Admin shield | only visible to platform admins */}
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
    </header>
  )
}
