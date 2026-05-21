'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { WorkflowLogOption } from '@/app/(dashboard)/workflows/logs/actions'
import { cn } from '@/lib/utils'

interface LogsFiltersProps {
  workflowOptions: WorkflowLogOption[]
  showWorkflowFilter?: boolean
  basePath: string
  // Current values from server searchParams
  status?: string
  workflow?: string
  from?: string
  to?: string
  q?: string
}

export function LogsFilters({
  workflowOptions,
  showWorkflowFilter = false,
  basePath,
  status = 'all',
  workflow = '',
  from = '',
  to = '',
  q = '',
}: LogsFiltersProps) {
  const router = useRouter()
  const [searchValue, setSearchValue] = useState(q)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [workflowSearch, setWorkflowSearch] = useState('')

  useEffect(() => {
    setSearchValue(q)
  }, [q])

  function buildUrl(overrides: Partial<{ status: string; workflow: string; from: string; to: string; q: string }>) {
    const merged = { status, workflow, from, to, q, ...overrides }
    const params = new URLSearchParams()
    if (merged.status && merged.status !== 'all') params.set('status', merged.status)
    if (merged.workflow) params.set('workflow', merged.workflow)
    if (merged.from) params.set('from', merged.from)
    if (merged.to) params.set('to', merged.to)
    if (merged.q) params.set('q', merged.q)
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  function push(overrides: Partial<{ status: string; workflow: string; from: string; to: string; q: string }>) {
    router.push(buildUrl(overrides))
  }

  function submitSearch() {
    push({ q: searchValue.trim() })
  }

  const hasFilters = (status && status !== 'all') || workflow || from || to || q
  const selectedWorkflow = workflowOptions.find((option) => option.id === workflow)
  const filteredWorkflowOptions = useMemo(() => {
    const needle = workflowSearch.trim().toLowerCase()
    if (!needle) return workflowOptions

    return workflowOptions.filter((option) => {
      const haystack = `${option.name} ${option.tool_name ?? ''}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [workflowOptions, workflowSearch])

  function selectWorkflow(nextWorkflow: string) {
    setWorkflowOpen(false)
    setWorkflowSearch('')
    push({ workflow: nextWorkflow })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Status */}
      <Select value={status || 'all'} onValueChange={(v) => push({ status: v })}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="error">Error</SelectItem>
          <SelectItem value="timeout">Timeout</SelectItem>
        </SelectContent>
      </Select>

      {/* Workflow filter */}
      {showWorkflowFilter && (
        <Popover open={workflowOpen} onOpenChange={setWorkflowOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-8 w-48 justify-between gap-2 px-3 text-xs font-medium"
            >
              <span className="truncate">{selectedWorkflow?.name ?? 'All workflows'}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="border-b border-border p-2">
              <Input
                value={workflowSearch}
                onChange={(e) => setWorkflowSearch(e.target.value)}
                placeholder="Search workflows..."
                className="h-8 text-xs"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => selectWorkflow('')}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-bg-tertiary"
              >
                <Check className={cn('h-3.5 w-3.5', !workflow ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">All workflows</span>
              </button>

              {filteredWorkflowOptions.map((workflowOption) => (
                <button
                  key={workflowOption.id}
                  type="button"
                  onClick={() => selectWorkflow(workflowOption.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-bg-tertiary"
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      workflowOption.id === workflow ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{workflowOption.name}</span>
                </button>
              ))}

              {filteredWorkflowOptions.length === 0 && (
                <div className="px-3 py-3 text-xs text-text-tertiary">No workflows found</div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Date from | key forces remount when value cleared */}
      <Input
        key={`from-${from}`}
        type="date"
        defaultValue={from}
        className="h-8 w-36 text-xs"
        onChange={(e) => push({ from: e.target.value })}
      />

      {/* Date to */}
      <Input
        key={`to-${to}`}
        type="date"
        defaultValue={to}
        className="h-8 w-36 text-xs"
        onChange={(e) => push({ to: e.target.value })}
      />

      {/* Search */}
      <Input
        key={`q-${q}`}
        type="search"
        placeholder="Search call ID..."
        value={searchValue}
        className="h-8 w-44 text-xs"
        onChange={(e) => setSearchValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitSearch()
        }}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={submitSearch}
      >
        <Search className="h-3.5 w-3.5" />
        Search
      </Button>

      {/* Clear */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => router.push(basePath)}
        >
          Clear filters
        </Button>
      )}
    </div>
  )
}
