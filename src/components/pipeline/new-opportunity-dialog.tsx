'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Plus, X, UserPlus } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createOpportunity,
  searchContactsForOpportunity,
  getStages,
} from '@/app/(dashboard)/pipeline/actions'
import {
  listTags,
  setOpportunityTags,
  type TagRow,
} from '@/app/(dashboard)/settings/tags/actions'
import { createContact } from '@/app/(dashboard)/contacts/actions'
import { TagPicker } from '@/components/tags/tag-picker'
import { isValidEmail } from '@/lib/contacts/zod-schemas'
import { displayContactName, splitContactName } from '@/lib/contacts/names'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import type { Database } from '@/types/database'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']

interface ContactSuggestion {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
}

interface NewOpportunityDialogProps {
  pipelineId: string
  stageId?: string
  children?: React.ReactNode
  defaultContactId?: string
  defaultCurrency?: string
}

export function NewOpportunityDialog({
  pipelineId,
  stageId,
  children,
  defaultContactId,
  defaultCurrency = 'USD',
}: NewOpportunityDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [stages, setStages] = React.useState<StageRow[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [value, setValue] = React.useState('')
  const [selectedStage, setSelectedStage] = React.useState<string | undefined>(stageId)
  const [contact, setContact] = React.useState<ContactSuggestion | null>(null)
  const [contactQuery, setContactQuery] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<ContactSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = React.useState(false)
  const [contactError, setContactError] = React.useState<string | null>(null)
  const [allTags, setAllTags] = React.useState<TagRow[]>([])
  const [tagIds, setTagIds] = React.useState<string[]>([])

  // Inline quick-create contact state
  const [showQuickCreate, setShowQuickCreate] = React.useState(false)
  const [quickName, setQuickName] = React.useState('')
  const [quickPhone, setQuickPhone] = React.useState('')
  const [quickEmail, setQuickEmail] = React.useState('')
  const [quickEmailError, setQuickEmailError] = React.useState<string | null>(null)
  const [quickCreating, setQuickCreating] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    getStages(pipelineId).then((s) => {
      setStages(s)
      if (!selectedStage && s.length > 0) setSelectedStage(s[0].id)
    })
    listTags().then(setAllTags)
  }, [open, pipelineId, selectedStage])

  React.useEffect(() => {
    if (defaultContactId && open && !contact) {
      searchContactsForOpportunity('').then((rows) => {
        const match = rows.find((r) => r.id === defaultContactId)
        if (match) setContact(match)
      })
    }
  }, [defaultContactId, open, contact])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    const t = setTimeout(async () => {
      const rows = await searchContactsForOpportunity(contactQuery)
      if (!cancelled) setSuggestions(rows)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [contactQuery, open])

  function reset() {
    setTitle('')
    setValue('')
    setContact(null)
    setContactQuery('')
    setShowSuggestions(false)
    setContactError(null)
    setTagIds([])
    setShowQuickCreate(false)
    setQuickName('')
    setQuickPhone('')
    setQuickEmail('')
    setQuickEmailError(null)
  }

  async function handleQuickCreate() {
    if (!quickName.trim() && !quickPhone.trim() && !quickEmail.trim()) {
      toast.error('Enter at least a name, phone, or email')
      return
    }
    if (quickEmail.trim() && !isValidEmail(quickEmail)) {
      setQuickEmailError('Enter a valid email address')
      return
    }
    setQuickEmailError(null)
    setQuickCreating(true)
    const res = await createContact({
      name: quickName.trim() || undefined,
      phone: quickPhone.trim() || undefined,
      email: quickEmail.trim() || undefined,
    })
    setQuickCreating(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    // Phase 107 / D-04 note: quick-create silently auto-selects the contact id,
    // even when matched_via === 'multi_conflict'. The conflict status surfaces
    // via the contact card badge (Phase 110). RESEARCH.md Open Question 3.
    const { id, existed: _existed, matched_via: _matched_via } = res
    void _existed
    void _matched_via
    const splitName = splitContactName(quickName)
    const newContact: ContactSuggestion = {
      id: id!,
      first_name: splitName.firstName,
      last_name: splitName.lastName,
      name: quickName.trim() || null,
      phone: quickPhone.trim() || null,
      email: quickEmail.trim() || null,
    }
    setContact(newContact)
    setContactError(null)
    setShowQuickCreate(false)
    setShowSuggestions(false)
    setQuickName('')
    setQuickPhone('')
    setQuickEmail('')
    setQuickEmailError(null)
    // No toast: per Phase 107 CONTEXT, quick-create stays silent regardless of matched_via.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contact) {
      setContactError('Select or create a contact before saving')
      return
    }
    if (!selectedStage) {
      toast.error('Pick a stage')
      return
    }
    setSubmitting(true)
    const numericValue = Number(value.replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0
    const res = await createOpportunity({
      title: title.trim(),
      value: numericValue,
      currency: defaultCurrency,
      pipeline_id: pipelineId,
      stage_id: selectedStage,
      contact_id: contact.id,
      status: 'open',
    })
    setSubmitting(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    if (tagIds.length > 0 && res.id) {
      await setOpportunityTags(res.id, tagIds)
    }
    toast.success('Opportunity created')
    setOpen(false)
    reset()
    router.refresh()
  }

  const fieldHeight = 'h-9'

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        {children ?? (
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> Deal
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New opportunity</DialogTitle>
          <DialogDescription>
            Create a deal in the pipeline and link it to a contact.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Setup + onboarding"
              required
              maxLength={160}
              className={fieldHeight}
            />
          </div>

          {/* Value */}
          <div className="space-y-1.5">
            <Label htmlFor="value">Value ({defaultCurrency})</Label>
            <Input
              id="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={(e) => {
                const n = parseFloat(e.target.value.replace(/[^0-9.,-]/g, '').replace(',', '.'))
                if (!isNaN(n)) setValue(n.toFixed(2))
              }}
              inputMode="decimal"
              placeholder="0,00"
              className={fieldHeight}
            />
          </div>

          {/* Stage */}
          <div className="space-y-1.5">
            <Label htmlFor="stage">Stage</Label>
            <Select value={selectedStage} onValueChange={setSelectedStage}>
              <SelectTrigger
                id="stage"
                className={`${fieldHeight} bg-bg-secondary border-border-subtle text-text-primary`}
              >
                <SelectValue placeholder="Choose stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Contact */}
          <div className="space-y-1.5">
            <Label htmlFor="contact" className={contactError ? 'text-destructive' : ''}>
              Contact <span className="text-destructive">*</span>
            </Label>
            {contact ? (
              <div className={`flex items-center justify-between gap-2 rounded-[8px] border ${contactError ? 'border-destructive' : 'border-border-subtle'} bg-bg-secondary px-3 ${fieldHeight}`}>
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-text-primary truncate">
                    {displayContactName(contact, 'Unnamed')}
                  </span>
                  {(contact.phone ?? contact.email) && (
                    <span className="ml-2 text-[11.5px] text-text-tertiary truncate">
                      {contact.phone ? formatPhoneDisplay(contact.phone) : contact.email}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setContact(null)}
                  className="text-text-tertiary hover:text-text-primary shrink-0"
                  aria-label="Clear contact"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
                <Input
                  id="contact"
                  value={contactQuery}
                  onChange={(e) => {
                    setContactQuery(e.target.value)
                    setShowSuggestions(true)
                    setShowQuickCreate(false)
                    if (contactError) setContactError(null)
                  }}
                  onFocus={() => { setShowSuggestions(true); setShowQuickCreate(false) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  placeholder="Search by name, phone, or email"
                  className={`pl-8 ${fieldHeight} ${contactError ? 'border-destructive' : ''}`}
                />
                {(showSuggestions || showQuickCreate) && (
                  <div className="absolute z-50 mt-1 w-full rounded-[8px] border border-border-subtle bg-bg-primary shadow-elevation-md max-h-[260px] overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setContact(s)
                          setContactError(null)
                          setShowSuggestions(false)
                          setContactQuery('')
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-bg-secondary text-left"
                      >
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-text-primary truncate">
                            {displayContactName(s, 'Unnamed')}
                          </div>
                          <div className="text-[11px] text-text-tertiary truncate">
                            {s.phone ? formatPhoneDisplay(s.phone) : s.email ?? ''}
                          </div>
                        </div>
                      </button>
                    ))}

                    {/* Quick-create toggle */}
                    {!showQuickCreate && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowQuickCreate(true)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-[12.5px] text-text-secondary hover:bg-bg-secondary border-t border-border-subtle"
                      >
                        <UserPlus className="h-3.5 w-3.5 shrink-0" />
                        Create new contact
                        {contactQuery && (
                          <span className="text-text-tertiary">"{contactQuery}"</span>
                        )}
                      </button>
                    )}

                    {/* Inline quick-create form */}
                    {showQuickCreate && (
                      <div className="p-3 border-t border-border-subtle space-y-2">
                        <p className="text-[11.5px] text-text-tertiary font-medium uppercase tracking-wide">New contact</p>
                        <Input
                          placeholder="Name"
                          value={quickName}
                          onChange={(e) => setQuickName(e.target.value)}
                          className="h-8 text-[13px]"
                          autoFocus
                        />
                        <PhoneInput
                          placeholder="Phone"
                          value={quickPhone}
                          onChange={setQuickPhone}
                        />
                        <Input
                          placeholder="Email"
                          value={quickEmail}
                          onChange={(e) => {
                            setQuickEmail(e.target.value)
                            if (quickEmailError) setQuickEmailError(null)
                          }}
                          className={quickEmailError ? 'h-8 text-[13px] border-destructive' : 'h-8 text-[13px]'}
                          type="email"
                          aria-invalid={Boolean(quickEmailError)}
                        />
                        {quickEmailError && (
                          <p className="text-[11.5px] text-destructive">{quickEmailError}</p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 text-[12px] flex-1"
                            disabled={quickCreating}
                            onClick={handleQuickCreate}
                          >
                            {quickCreating ? 'Creating…' : 'Create & select'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[12px]"
                            onClick={() => setShowQuickCreate(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {contactError && (
              <p className="text-[12px] text-destructive">{contactError}</p>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label>Tags</Label>
            <TagPicker
              allTags={allTags}
              value={tagIds}
              onChange={setTagIds}
              onTagCreated={(tag) => setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))}
              placeholder="Add tags…"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
