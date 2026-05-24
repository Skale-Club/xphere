'use client'

import * as React from 'react'
import { Building2, Plus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import { getAccounts, createAccount } from '@/app/(dashboard)/companies/actions'
import type { AccountWithCounts } from '@/lib/accounts'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AccountComboboxProps {
  value: string | null
  onChange: (accountId: string | null, accountName: string | null) => void
  defaultAccountName?: string
  allowUnlink?: boolean
}

export function AccountCombobox({
  value,
  onChange,
  defaultAccountName,
  allowUnlink = true,
}: AccountComboboxProps) {
  const [inputValue, setInputValue] = React.useState<string>(defaultAccountName ?? '')
  const [results, setResults] = React.useState<AccountWithCounts[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [isOpen, setIsOpen] = React.useState(false)
  const [showCreate, setShowCreate] = React.useState(false)
  const [createName, setCreateName] = React.useState('')
  const [isCreating, setIsCreating] = React.useState(false)

  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (value === null && !defaultAccountName) {
      setInputValue('')
    }
  }, [value, defaultAccountName])

  React.useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setShowCreate(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!inputValue) {
      setResults([])
      setIsLoading(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const domainFromEmail = inputValue.includes('@')
          ? (inputValue.split('@')[1]?.trim().toLowerCase() ?? '')
          : ''

        const [qResult, domainResult] = await Promise.all([
          getAccounts({ q: inputValue, pageSize: 10 }),
          domainFromEmail.length > 0
            ? getAccounts({ q: domainFromEmail, pageSize: 5 })
            : Promise.resolve({ ok: false as const, error: '' }),
        ])

        const qRows = qResult.ok ? (qResult.data.rows as AccountWithCounts[]) : []
        const domainRows = domainResult.ok ? (domainResult.data.rows as AccountWithCounts[]) : []

        const seen = new Set<string>()
        const merged: AccountWithCounts[] = []
        for (const row of [...domainRows, ...qRows]) {
          if (!seen.has(row.id)) {
            seen.add(row.id)
            merged.push(row)
          }
        }
        setResults(merged.slice(0, 15))
      } catch {
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [inputValue])

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value
    setInputValue(nextValue)
    setIsOpen(true)
    setShowCreate(false)
    if (!nextValue) {
      onChange(null, null)
    }
  }

  function handleSelect(id: string, name: string) {
    onChange(id, name)
    setInputValue(name)
    setIsOpen(false)
    setShowCreate(false)
  }

  function handleClear() {
    onChange(null, null)
    setInputValue('')
    setResults([])
    setIsOpen(false)
    setShowCreate(false)
  }

  async function handleCreate() {
    if (!createName.trim()) return
    setIsCreating(true)
    try {
      const result = await createAccount({ name: createName.trim() })
      if (result.ok) {
        onChange(result.data.id, result.data.name)
        setInputValue(result.data.name)
        setIsOpen(false)
        setShowCreate(false)
        setCreateName('')
        toast.success('Company created')
      } else {
        toast.error('Failed to create company')
      }
    } catch {
      toast.error('Failed to create company')
    } finally {
      setIsCreating(false)
    }
  }

  const showDropdown = isOpen && (inputValue.length > 0 || showCreate)

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Input
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (inputValue) setIsOpen(true)
          }}
          placeholder="Search or create company..."
          className={cn('h-10 text-[13.5px]', allowUnlink && inputValue && 'pr-9')}
          autoComplete="off"
        />
        {allowUnlink && inputValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            aria-label="Unlink company"
            title="Unlink company"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showDropdown && !showCreate && (
        <div className="absolute z-50 mt-1 max-h-[200px] w-full overflow-y-auto rounded-[10px] border border-border bg-bg-secondary shadow-lg">
          {isLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />
            </div>
          )}

          {!isLoading && results.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => handleSelect(account.id, account.name)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-bg-tertiary"
            >
              <Building2 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              <span className="truncate font-medium text-text-primary">{account.name}</span>
              {account.domain && (
                <span className="ml-auto shrink-0 text-[11.5px] text-text-tertiary">
                  {account.domain}
                </span>
              )}
            </button>
          ))}

          {!isLoading && results.length === 0 && inputValue.length > 0 && (
            <div className="px-3 py-2 text-[12.5px] text-text-tertiary">
              No companies found
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setCreateName(inputValue)
              setShowCreate(true)
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-accent hover:bg-accent/10',
              results.length > 0 && 'border-t border-border',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Create new company &quot;{inputValue || '...'}&quot;
          </button>
        </div>
      )}

      {showDropdown && showCreate && (
        <div className="absolute z-50 mt-1 w-full space-y-2 rounded-[10px] border border-border bg-bg-secondary p-3 shadow-lg">
          <p className="text-[12px] font-medium text-text-primary">New company</p>
          <Input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Company name"
            autoFocus
            className="h-9 text-[13px]"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleCreate()
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!createName.trim() || isCreating}
              onClick={handleCreate}
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
