'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface ListPageShellProps {
  addButton: React.ReactNode
  searchQuery: string
  onSearchChange: (q: string) => void
  searchPlaceholder?: string
  filterButton?: React.ReactNode
  actionsDropdown?: React.ReactNode
  activeFilterChips?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function ListPageShell({
  addButton,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filterButton,
  actionsDropdown,
  activeFilterChips,
  children,
  className,
}: ListPageShellProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Toolbar — single line everywhere */}
      <div className="animate-fade-in flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2">
        {/* Add button — always leftmost */}
        {addButton}

        {/* Search — compact, flex-1 */}
        <div className="relative flex-1 min-w-0 max-w-[220px] sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8 h-8 text-[12.5px]"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Spacer to push remaining items right on desktop */}
        <div className="hidden sm:block flex-1" />

        {/* Desktop actions — inline, hidden on mobile */}
        <div className="hidden sm:flex items-center gap-2">
          {filterButton}
        </div>

        {/* Mobile filter button */}
        {filterButton && (
          <div className="sm:hidden">
            {filterButton}
          </div>
        )}

        {/* Actions dropdown (More ⋮) — always visible */}
        {actionsDropdown}
      </div>

      {/* Active filter chips */}
      {activeFilterChips}

      {/* Content */}
      {children}
    </div>
  )
}
