'use client'

import * as React from 'react'
import { Bell, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AppBreadcrumb } from './app-breadcrumb'
import { ThemeToggle } from '@/components/theme-toggle'
import { useCommandPalette } from '@/components/command-palette'
import { useSidebarState } from './sidebar-context'
import { cn } from '@/lib/utils'

export function TopBar() {
  const { setOpen } = useCommandPalette()
  const { collapsed } = useSidebarState()
  const [hasNotifications] = React.useState(false) // mock

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4',
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Notifications"
              className="relative text-text-secondary hover:text-text-primary"
            >
              <Bell className="h-[15px] w-[15px]" />
              {hasNotifications && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-bg-primary" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Notifications</TooltipContent>
        </Tooltip>

        <ThemeToggle />
      </div>
    </header>
  )
}
