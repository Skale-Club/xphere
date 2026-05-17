'use client'

import * as React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, Filter, X, ChevronDown, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContactDetailSheet } from './contact-detail-sheet'
import { deleteContacts } from '@/app/(dashboard)/contacts/actions'
import type { Database } from '@/types/database'
import { CONTACT_SOURCES } from '@/lib/contacts/zod-schemas'
import { cn } from '@/lib/utils'

type ContactRow = Database['public']['Tables']['contacts']['Row']

interface ContactsTableProps {
  rows: ContactRow[]
  total: number
  page: number
  pageSize: number
  allTags: string[]
  currentTag?: string
  currentSource?: string
  currentSort: string
  currentQuery?: string
}

function initialsOf(name: string | null, phone: string | null, email: string | null): string {
  const base = name || email || phone || '?'
  const parts = base.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/)
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return base.slice(0, 2).toUpperCase()
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ContactsTable({
  rows,
  total,
  page,
  pageSize,
  allTags,
  currentTag,
  currentSource,
  currentSort,
  currentQuery,
}: ContactsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [query, setQuery] = React.useState(currentQuery ?? '')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  // Optimistic "pending delete" set — rows fade out immediately on delete
  // and snap back if the server returns an error.
  const [pendingDelete, setPendingDelete] = React.useState<Set<string>>(new Set())

  // Reset selection when rows change
  React.useEffect(() => {
    setSelected(new Set())
    setPendingDelete(new Set())
  }, [rows])

  // Debounced search → URL
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

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    if (key !== 'page') params.delete('page')
    router.replace(`${pathname}?${params.toString()}`)
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === rows.length && rows.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map((r) => r.id)))
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} contact(s)? This cannot be undone.`)) return
    const ids = [...selected]
    // Optimistic: mark rows as pending-delete so they fade out instantly.
    setPendingDelete(new Set(ids))
    const res = await deleteContacts(ids)
    if (res.error) {
      // Rollback the visual change on error.
      setPendingDelete(new Set())
      toast.error(res.error)
      return
    }
    toast.success(`Deleted ${res.deleted ?? 0} contact(s)`)
    setSelected(new Set())
    router.refresh()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showFilters = Boolean(currentTag || currentSource)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone, email or company…"
            className="pl-9 h-10 text-[13.5px]"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={currentSource ?? 'all'}
            onValueChange={(v) => setParam('source', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-10 w-[140px] text-[12.5px]">
              <Filter className="h-3.5 w-3.5 text-text-tertiary" />
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {CONTACT_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {sourceLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={currentSort} onValueChange={(v) => setParam('sort', v === 'recent' ? null : v)}>
            <SelectTrigger className="h-10 w-[130px] text-[12.5px]">
              <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent</SelectItem>
              <SelectItem value="name">By name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tag chips */}
      {(allTags.length > 0 || currentTag) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-text-tertiary mr-1">Tags</span>
          {currentTag && !allTags.includes(currentTag) && (
            <TagChip label={currentTag} active onClick={() => setParam('tag', null)} />
          )}
          {allTags.map((t) => (
            <TagChip
              key={t}
              label={t}
              active={currentTag === t}
              onClick={() => setParam('tag', currentTag === t ? null : t)}
            />
          ))}
        </div>
      )}

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-[10px] border border-accent/30 bg-accent-muted/40 px-3 py-2">
          <span className="text-[12.5px] text-text-primary">
            {selected.size} selected
          </span>
          <Button size="sm" variant="ghost" onClick={handleBulkDelete} className="text-rose-400 hover:text-rose-300">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        <div className="grid grid-cols-[40px_2fr_1.5fr_1.2fr_1fr_100px] items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          <Checkbox
            checked={selected.size === rows.length && rows.length > 0}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <div>Contact</div>
          <div>Phone</div>
          <div>Email</div>
          <div>Tags</div>
          <div className="text-right">Added</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-text-secondary">
            {showFilters || currentQuery
              ? 'No contacts match your filters.'
              : 'No contacts to show yet.'}
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {rows.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setOpenId(c.id)
                  }
                }}
                className={cn(
                  'grid grid-cols-[40px_2fr_1.5fr_1.2fr_1fr_100px] items-center gap-3 px-4 py-3 cursor-pointer',
                  'transition-all duration-200 ease-out hover:bg-bg-tertiary/40 focus:outline-none focus-visible:bg-bg-tertiary/40',
                  pendingDelete.has(c.id) && 'opacity-30 -translate-x-2 pointer-events-none',
                )}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggleRow(c.id)}
                    aria-label={`Select ${c.name ?? 'contact'}`}
                  />
                </div>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-[11px] font-semibold bg-accent-muted text-accent">
                      {initialsOf(c.name, c.phone, c.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {c.name || <span className="italic text-text-tertiary">Unnamed</span>}
                    </div>
                    {c.company && (
                      <div className="truncate text-[11.5px] text-text-tertiary">{c.company}</div>
                    )}
                  </div>
                </div>
                <div className="truncate text-[12.5px] text-text-secondary tabular-nums">
                  {c.phone || '—'}
                </div>
                <div className="truncate text-[12.5px] text-text-secondary">{c.email || '—'}</div>
                <div className="flex flex-wrap gap-1 overflow-hidden">
                  {c.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-full bg-accent-muted px-2 py-0.5 text-[10.5px] font-medium text-accent"
                    >
                      {t}
                    </span>
                  ))}
                  {c.tags.length > 2 && (
                    <span className="text-[10.5px] text-text-tertiary">+{c.tags.length - 2}</span>
                  )}
                </div>
                <div className="text-right text-[11.5px] text-text-tertiary">
                  {relativeTime(c.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-tertiary">
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages}
              onClick={() => setParam('page', String(page + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ContactDetailSheet contactId={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  )
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors duration-150',
        active
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-border-subtle bg-bg-secondary text-text-secondary hover:border-border-strong hover:text-text-primary',
      )}
    >
      {label}
      {active && <X className="h-3 w-3" />}
    </button>
  )
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'manual':
      return 'Manual'
    case 'whatsapp':
      return 'WhatsApp'
    case 'sms':
      return 'SMS'
    case 'instagram':
      return 'Instagram'
    case 'csv_import':
      return 'CSV import'
    case 'ghl_sync':
      return 'GHL sync'
    default:
      return s
  }
}
