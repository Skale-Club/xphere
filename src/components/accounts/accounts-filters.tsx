'use client'

import * as React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, X, Filter, MoreHorizontal, Download, Loader2, Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ACCOUNT_SIZES, ACCOUNT_SOURCES } from '@/lib/accounts'
import { exportAccountsCsv } from '@/app/(dashboard)/companies/actions'
import { NewCompanyDialog } from './new-company-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountsFiltersProps {
  currentQuery?: string
  currentIndustry?: string
  currentSize?: string
  currentTag?: string
  currentAssignedTo?: string
  currentSource?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INDUSTRY_OPTIONS = [
  'Technology',
  'Finance',
  'Healthcare',
  'Retail',
  'Manufacturing',
  'Education',
  'Real Estate',
  'Other',
] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sourceLabel(s: string): string {
  switch (s) {
    case 'manual':
      return 'Manual'
    case 'auto_from_contact_company':
      return 'Auto-imported'
    case 'csv_import':
      return 'CSV import'
    case 'ghl_sync':
      return 'GHL sync'
    default:
      return s
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AccountsFilters({
  currentQuery,
  currentIndustry,
  currentSize,
  currentTag,
  currentAssignedTo,
  currentSource,
}: AccountsFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Local state for debounced inputs
  const [query, setQuery] = React.useState(currentQuery ?? '')
  const [tagInput, setTagInput] = React.useState(currentTag ?? '')
  const [ownerInput, setOwnerInput] = React.useState(currentAssignedTo ?? '')

  // Sync local state when URL params change (e.g., chip clear)
  React.useEffect(() => {
    setQuery(currentQuery ?? '')
  }, [currentQuery])

  React.useEffect(() => {
    setTagInput(currentTag ?? '')
  }, [currentTag])

  React.useEffect(() => {
    setOwnerInput(currentAssignedTo ?? '')
  }, [currentAssignedTo])

  // ─── setParam helper ─────────────────────────────────────────────────────

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    if (key !== 'page') params.delete('page')
    router.replace(`${pathname}?${params.toString()}`)
  }

  // ─── Debounced search → URL ───────────────────────────────────────────────

  React.useEffect(() => {
    if ((currentQuery ?? '') === query) return
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (query) params.set('q', query)
      else params.delete('q')
      params.delete('page')
      router.replace(`${pathname}?${params.toString()}`)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // ─── Debounced tag → URL ─────────────────────────────────────────────────

  React.useEffect(() => {
    if ((currentTag ?? '') === tagInput) return
    const timer = setTimeout(() => {
      setParam('tag', tagInput || null)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagInput])

  // ─── Debounced owner → URL ───────────────────────────────────────────────

  React.useEffect(() => {
    if ((currentAssignedTo ?? '') === ownerInput) return
    const timer = setTimeout(() => {
      setParam('assigned_to', ownerInput || null)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerInput])

  // ─── Active filter chips ──────────────────────────────────────────────────

  const activeFilters = [
    { key: 'q', label: `Search: "${currentQuery}"`, value: currentQuery },
    { key: 'industry', label: `Industry: ${currentIndustry}`, value: currentIndustry },
    { key: 'size', label: `Size: ${currentSize}`, value: currentSize },
    { key: 'tag', label: `Tag: ${currentTag}`, value: currentTag },
    { key: 'assigned_to', label: `Owner: ${currentAssignedTo}`, value: currentAssignedTo },
    {
      key: 'source',
      label: `Source: ${sourceLabel(currentSource ?? '')}`,
      value: currentSource,
    },
  ].filter((f) => Boolean(f.value))

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('q')
    params.delete('industry')
    params.delete('size')
    params.delete('tag')
    params.delete('assigned_to')
    params.delete('source')
    params.delete('page')
    router.replace(`${pathname}?${params.toString()}`)
    // Clear local debounced inputs immediately
    setQuery('')
    setTagInput('')
    setOwnerInput('')
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
      {/* Toolbar row */}
      <div className="animate-fade-in flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2">
        <NewCompanyDialog
          trigger={
            <Button size="sm" className="h-8">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Company</span>
            </Button>
          }
        />

        {/* Search input */}
        <div className="relative flex-1 min-w-0 max-w-[200px] sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="pl-8 h-8 text-[12.5px]"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="hidden sm:block flex-1" />

        {/* Desktop: full filter controls */}
        <div className="hidden sm:flex items-center gap-2">
          <Select
            value={currentIndustry ?? 'all'}
            onValueChange={(v) => setParam('industry', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-8 w-[130px] text-[12.5px]">
              <SelectValue placeholder="Industry" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All industries</SelectItem>
              {INDUSTRY_OPTIONS.map((ind) => (
                <SelectItem key={ind} value={ind}>
                  {ind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={currentSize ?? 'all'}
            onValueChange={(v) => setParam('size', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-8 w-[110px] text-[12.5px]">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sizes</SelectItem>
              {ACCOUNT_SIZES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Tag…"
              className="h-8 w-[100px] text-[12.5px]"
            />
            {tagInput && (
              <button
                onClick={() => setTagInput('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                aria-label="Clear tag filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="relative">
            <Input
              value={ownerInput}
              onChange={(e) => setOwnerInput(e.target.value)}
              placeholder="Owner…"
              className="h-8 w-[100px] text-[12.5px]"
            />
            {ownerInput && (
              <button
                onClick={() => setOwnerInput('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                aria-label="Clear owner filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <Select
            value={currentSource ?? 'all'}
            onValueChange={(v) => setParam('source', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-8 w-[120px] text-[12.5px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {ACCOUNT_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {sourceLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* More actions dropdown — all breakpoints */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="h-8 px-2.5">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <ExportMenuItem />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile: source filter icon */}
        <div className="sm:hidden flex items-center gap-1.5">
          <Select
            value={currentSource ?? 'all'}
            onValueChange={(v) => setParam('source', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-8 w-9 px-0 justify-center text-[12.5px]">
              <Filter className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {ACCOUNT_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {sourceLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="h-8 px-2.5">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <ExportMenuItem />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              onRemove={() => {
                setParam(f.key, null)
                // Also reset corresponding local state
                if (f.key === 'q') setQuery('')
                if (f.key === 'tag') setTagInput('')
                if (f.key === 'assigned_to') setOwnerInput('')
              }}
            />
          ))}
          {activeFilters.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-6 px-2 text-[11px] text-text-tertiary hover:text-text-primary"
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ExportMenuItem ───────────────────────────────────────────────────────────

function ExportMenuItem() {
  const [exporting, setExporting] = React.useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const res = await exportAccountsCsv()
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (!res.csv) return
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'companies.csv'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <DropdownMenuItem onClick={handleExport} disabled={exporting}>
      {exporting ? (
        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5 mr-2" />
      )}
      Export CSV
    </DropdownMenuItem>
  )
}

// ─── FilterChip ───────────────────────────────────────────────────────────────

function FilterChip({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-secondary',
        'px-2.5 py-0.5 text-[11.5px] font-medium text-text-secondary',
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
