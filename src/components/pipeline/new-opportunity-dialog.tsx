'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Plus, X } from 'lucide-react'

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
import type { Database } from '@/types/database'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']

interface ContactSuggestion {
  id: string
  name: string | null
  phone: string | null
  email: string | null
}

interface NewOpportunityDialogProps {
  pipelineId: string
  stageId?: string
  children?: React.ReactNode
  defaultContactId?: string
}

export function NewOpportunityDialog({
  pipelineId,
  stageId,
  children,
  defaultContactId,
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

  React.useEffect(() => {
    if (!open) return
    getStages(pipelineId).then((s) => {
      setStages(s)
      if (!selectedStage && s.length > 0) setSelectedStage(s[0].id)
    })
  }, [open, pipelineId, selectedStage])

  React.useEffect(() => {
    if (defaultContactId && open && !contact) {
      // Defer contact-loading: when opened from contact detail, the consumer
      // can pre-supply contact, but if we only get the id, fetch via search.
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
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedStage) {
      toast.error('Pick a stage')
      return
    }
    setSubmitting(true)
    const numericValue = Number(value.replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0
    const res = await createOpportunity({
      title: title.trim(),
      value: numericValue,
      currency: 'BRL',
      pipeline_id: pipelineId,
      stage_id: selectedStage,
      contact_id: contact?.id ?? null,
      status: 'open',
    })
    setSubmitting(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Opportunity created')
    setOpen(false)
    reset()
    router.refresh()
  }

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
            <Plus className="h-3.5 w-3.5" /> New opportunity
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
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Setup + onboarding"
              required
              maxLength={160}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="value">Value (BRL)</Label>
              <Input
                id="value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stage">Stage</Label>
              <Select value={selectedStage} onValueChange={setSelectedStage}>
                <SelectTrigger id="stage">
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact">Contact</Label>
            {contact ? (
              <div className="flex items-center justify-between gap-2 rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-text-primary truncate">
                    {contact.name ?? 'Unnamed'}
                  </div>
                  <div className="text-[11.5px] text-text-tertiary truncate">
                    {contact.phone ?? contact.email ?? ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setContact(null)}
                  className="text-text-tertiary hover:text-text-primary"
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
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Search by name, phone, or email"
                  className="pl-8"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full rounded-[8px] border border-border-subtle bg-bg-primary shadow-elevation-md max-h-[220px] overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setContact(s)
                          setShowSuggestions(false)
                          setContactQuery('')
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-bg-secondary text-left"
                      >
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-text-primary truncate">
                            {s.name ?? 'Unnamed'}
                          </div>
                          <div className="text-[11px] text-text-tertiary truncate">
                            {s.phone ?? s.email ?? ''}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
