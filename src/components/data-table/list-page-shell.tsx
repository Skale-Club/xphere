"use client";

import * as React from "react";

import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";

interface ListPageShellProps {
  addButton: React.ReactNode;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder?: string;
  filterButton?: React.ReactNode;
  actionsDropdown?: React.ReactNode;
  activeFilterChips?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function ListPageShell({
  addButton,
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search…",
  filterButton,
  actionsDropdown,
  activeFilterChips,
  children,
  className,
}: ListPageShellProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar — single line everywhere */}
      <div className="animate-fade-in flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2">
        {/* Add button — always leftmost */}
        {addButton}

        <SearchInput
          value={searchQuery}
          onValueChange={onSearchChange}
          onClear={() => onSearchChange("")}
          placeholder={searchPlaceholder}
        />

        {/* Spacer to push remaining items right on desktop */}
        <div className="hidden sm:block flex-1" />

        {/* Desktop actions — inline, hidden on mobile */}
        <div className="hidden sm:flex items-center gap-2">{filterButton}</div>

        {/* Mobile filter button */}
        {filterButton && <div className="sm:hidden">{filterButton}</div>}

        {/* Actions dropdown (More ⋮) — always visible */}
        {actionsDropdown}
      </div>

      {/* Active filter chips */}
      {activeFilterChips}

      {/* Content */}
      {children}
    </div>
  );
}
