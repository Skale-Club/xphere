'use client'

/**
 * "Add contact" control for the company modal. Search existing contacts and
 * link them to the company (sets contacts.account_id), or quick-create a new
 * contact (requires phone or email — Phase 109 invariant) and link it. Can be
 * used repeatedly to attach multiple contacts.
 *
 * Reuses searchContactsForOpportunity (generic contact search) and
 * createContact + linkContactToAccount.
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Search, UserPlus, X, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { displayContactName } from '@/lib/contacts/names'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
import { isValidEmail } from '@/lib/contacts/zod-schemas'
import { searchContactsForOpportunity } from '@/app/(dashboard)/pipeline/actions'
import { createContact } from '@/app/(dashboard)/contacts/actions'
import { linkContactToAccount } from '@/app/(dashboard)/companies/actions'

interface ContactSuggestion {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
}

interface AccountLinkContactProps {
  accountId: string
  /** Called after a contact is linked so the parent can re-fetch. */
  onLinked: () => void
}

export function AccountLinkContact({ accountId, onLinked }: AccountLinkContactProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<ContactSuggestion[]>([])
  const [busy, setBusy] = React.useState(false)

  const [showQuickCreate, setShowQuickCreate] = React.useState(false)
  const [quickName, setQuickName] = React.useState('')
  const [quickPhone, setQuickPhone] = React.useState('')
  const [quickEmail, setQuickEmail] = React.useState('')
  const [quickEmailError, setQuickEmailError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    const t = setTimeout(async () => {
      const rows = await searchContactsForOpportunity(query)
      if (!cancelled) setSuggestions(rows)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, open])

  function reset() {
    setQuery('')
    setSuggestions([])
    setShowQuickCreate(false)
    setQuickName('')
    setQuickPhone('')
    setQuickEmail('')
    setQuickEmailError(null)
  }

  function close() {
    setOpen(false)
    reset()
  }

  async function linkExisting(contactId: string) {
    setBusy(true)
    const res = await linkContactToAccount({ contactId, accountId })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error || 'Could not link contact')
      return
    }
    toast.success('Contact linked')
    close()
    onLinked()
  }

  async function handleQuickCreate() {
    if (!quickPhone.trim() && !quickEmail.trim()) {
      toast.error('Enter a phone or email')
      return
    }
    if (quickEmail.trim() && !isValidEmail(quickEmail)) {
      setQuickEmailError('Enter a valid email address')
      return
    }
    setQuickEmailError(null)
    setBusy(true)
    const created = await createContact({
      name: quickName.trim() || undefined,
      phone: quickPhone.trim() || undefined,
      email: quickEmail.trim() || undefined,
    })
    if (created.error || !created.id) {
      setBusy(false)
      toast.error(created.error || 'Could not create contact')
      return
    }
    const linkRes = await linkContactToAccount({ contactId: created.id, accountId })
    setBusy(false)
    if (!linkRes.ok) {
      toast.error(linkRes.error || 'Contact created but failed to link')
      return
    }
    toast.success('Contact created and linked')
    close()
    onLinked()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-border-subtle px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:border-border hover:bg-bg-tertiary/40 hover:text-text-primary"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Add contact
      </button>
    )
  }

  return (
    <div className="rounded-[10px] border border-border-subtle bg-bg-secondary/40 p-2">
      {!showQuickCreate ? (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, phone, or email"
              className="h-9 pl-8 pr-8 text-[13px]"
            />
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-1 max-h-[220px] overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={busy}
                onClick={() => void linkExisting(s.id)}
                className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-bg-tertiary/60 disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-text-primary">
                    {displayContactName(s, 'Unnamed')}
                  </div>
                  <div className="truncate text-[11px] text-text-tertiary">
                    {s.phone ? formatPhoneDisplay(s.phone) : formatEmailDisplay(s.email)}
                  </div>
                </div>
              </button>
            ))}

            <button
              type="button"
              onClick={() => setShowQuickCreate(true)}
              className="flex w-full items-center gap-2 rounded-[6px] border-t border-border-subtle px-2 py-2 text-[12.5px] text-text-secondary hover:bg-bg-tertiary/60"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" />
              Create new contact
              {query && <span className="truncate text-text-tertiary">&ldquo;{query}&rdquo;</span>}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2 p-1">
          <p className="text-[11.5px] font-medium uppercase tracking-wide text-text-tertiary">
            New contact
          </p>
          <Input
            autoFocus
            placeholder="Name"
            value={quickName}
            onChange={(e) => setQuickName(e.target.value)}
            className="h-8 text-[13px]"
          />
          <PhoneInput placeholder="Phone" value={quickPhone} onChange={setQuickPhone} />
          <Input
            placeholder="Email"
            type="email"
            value={quickEmail}
            onChange={(e) => {
              setQuickEmail(e.target.value)
              if (quickEmailError) setQuickEmailError(null)
            }}
            aria-invalid={Boolean(quickEmailError)}
            className={quickEmailError ? 'h-8 text-[13px] border-destructive' : 'h-8 text-[13px]'}
          />
          {quickEmailError && <p className="text-[11.5px] text-destructive">{quickEmailError}</p>}
          <div className="flex gap-2 pt-0.5">
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 text-[12px]"
              disabled={busy}
              onClick={() => void handleQuickCreate()}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create & link'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[12px]"
              onClick={() => setShowQuickCreate(false)}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
