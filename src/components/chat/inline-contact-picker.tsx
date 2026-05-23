'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, ChevronDown, ChevronUp } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  linkContactToConversation,
  searchContactsForLink,
} from '@/app/(dashboard)/chat/actions'
import { displayContactName, initialsFromContactName } from '@/lib/contacts/names'

interface ContactHit {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
}

interface InlineContactPickerProps {
  conversationId: string
  onLinked?: () => void
}

/**
 * Compact inline picker for linking an existing CRM contact to the
 * current conversation. Lives inside the "Contact not registered" card |
 * keeps the operator on the chat screen instead of opening a modal.
 *
 * Collapsed by default to avoid noise. Click "Link existing contact" to
 * expand, then type to search.
 */
export function InlineContactPicker({ conversationId, onLinked }: InlineContactPickerProps) {
  const [expanded, setExpanded] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [results, setResults] = React.useState<ContactHit[]>([])
  const [loading, setLoading] = React.useState(false)
  const [linkingId, setLinkingId] = React.useState<string | null>(null)
  const router = useRouter()

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(t)
  }, [query])

  React.useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setLoading(true)
    searchContactsForLink(debounced).then((data) => {
      if (cancelled) return
      setResults(data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [expanded, debounced])

  async function handleLink(contactId: string) {
    setLinkingId(contactId)
    const res = await linkContactToConversation(conversationId, contactId)
    setLinkingId(null)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Contact linked to conversation')
    setExpanded(false)
    setQuery('')
    onLinked?.()
    router.refresh()
  }

  return (
    <div className="text-left">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-[8px] border border-border-subtle bg-bg-tertiary/40 px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
      >
        <span>Link existing contact</span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
            <Input
              autoFocus
              placeholder="Search by name, phone, email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-8 text-[12px]"
            />
          </div>

          <div className="flex max-h-[240px] flex-col gap-1 overflow-y-auto">
            {loading && (
              <div className="py-3 text-center text-[11.5px] text-text-tertiary">
                Searching…
              </div>
            )}
            {!loading && results.length === 0 && (
              <div className="py-3 text-center text-[11.5px] text-text-tertiary">
                {query.trim() ? 'No contacts match' : 'No contacts yet'}
              </div>
            )}
            {!loading &&
              results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={linkingId !== null}
                  onClick={() => handleLink(c.id)}
                  className="flex items-center gap-2 rounded-[6px] border border-border-subtle bg-bg-primary px-2.5 py-1.5 text-left transition-colors hover:border-accent/40 hover:bg-bg-tertiary/40 disabled:opacity-50"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-muted text-[11px] font-semibold text-accent">
                    {initialsFromContactName(c, c.email ?? c.phone ?? '?')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-text-primary">
                      {displayContactName(c)}
                    </div>
                    <div className="truncate text-[10.5px] text-text-tertiary">
                      {[c.phone, c.email, c.company].filter(Boolean).join(' · ') ||
                        'No contact info'}
                    </div>
                  </div>
                  {linkingId === c.id && (
                    <span className="text-[10px] text-text-tertiary">Linking…</span>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
