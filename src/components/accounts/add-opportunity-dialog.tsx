'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Building2, User } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  getDefaultPipeline,
  getStages,
  setOpportunityAccount,
} from '@/app/(dashboard)/pipeline/actions'
import type { Database } from '@/types/database'
import { displayContactName } from '@/lib/contacts/names'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']
type PipelineRow = Database['public']['Tables']['pipelines']['Row']

interface AccountContact {
  id: string
  first_name?: string | null
  last_name?: string | null
  name: string | null
  phone: string | null
  email: string | null
}

interface AddOpportunityDialogProps {
  accountId: string
  accountContacts: AccountContact[]
  children?: React.ReactNode // custom trigger element
}

type CreationPath = 'contact' | 'account' | null

export function AddOpportunityDialog({
  accountId,
  accountContacts,
  children,
}: AddOpportunityDialogProps) {
  const router = useRouter()

  const [open, setOpen] = React.useState(false)
  const [path, setPath] = React.useState<CreationPath>(null)
  const [selectedContactId, setSelectedContactId] = React.useState<string>('')
  const [title, setTitle] = React.useState('')
  const [value, setValue] = React.useState('')
  const [pipeline, setPipeline] = React.useState<PipelineRow | null>(null)
  const [stages, setStages] = React.useState<StageRow[]>([])
  const [selectedStage, setSelectedStage] = React.useState<string>('')
  const [submitting, setSubmitting] = React.useState(false)

  // Load default pipeline + stages when dialog opens
  React.useEffect(() => {
    if (!open) return
    getDefaultPipeline().then(async (p) => {
      if (!p) return
      setPipeline(p)
      const s = await getStages(p.id)
      setStages(s)
      if (s.length > 0) setSelectedStage(s[0].id)
    })
  }, [open])

  function resetState() {
    setPath(null)
    setSelectedContactId('')
    setTitle('')
    setValue('')
    setStages([])
    setSelectedStage('')
    setPipeline(null)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) resetState()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!pipeline) {
      toast.error('No pipeline found. Create a pipeline first.')
      return
    }
    if (!selectedStage) {
      toast.error('Pick a stage')
      return
    }
    if (path === 'contact' && !selectedContactId) {
      toast.error('Pick a contact')
      return
    }

    setSubmitting(true)
    const numericValue =
      Number(value.replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0

    const res = await createOpportunity({
      title: title.trim(),
      value: numericValue,
      currency: 'USD',
      pipeline_id: pipeline.id,
      stage_id: selectedStage,
      contact_id: path === 'contact' ? selectedContactId : null,
      status: 'open',
    })

    if (res.error) {
      setSubmitting(false)
      toast.error(res.error)
      return
    }

    // Link to account | createOpportunity does not accept account_id in v2.4,
    // so we patch it immediately after creation via setOpportunityAccount.
    if (res.id) {
      const linkRes = await setOpportunityAccount(res.id, accountId)
      if (linkRes && 'error' in linkRes && linkRes.error) {
        toast.error('Opportunity created but failed to link to company.')
      }
    }

    setSubmitting(false)
    toast.success('Opportunity created')
    setOpen(false)
    resetState()
    router.refresh()
  }

  const trigger = children ?? (
    <Button size="sm" variant="secondary" id="add-opportunity-btn">
      Add opportunity
    </Button>
  )

  return (
    <>
      {/* Wrap the trigger so clicking it opens the dialog */}
      <span
        onClick={() => setOpen(true)}
        className="contents"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(true)
        }}
      >
        {trigger}
      </span>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add opportunity</DialogTitle>
            <DialogDescription>
              Create a deal linked to this company.
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Path selection */}
          {path === null && (
            <div className="space-y-3 pt-1">
              <p className="text-[13px] text-text-tertiary">How would you like to link this deal?</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPath('contact')}
                  disabled={accountContacts.length === 0}
                  className="flex flex-col gap-2 rounded-[10px] border border-border bg-bg-secondary p-4 text-left transition-colors hover:border-accent hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10">
                    <User className="h-4 w-4 text-accent" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">Link to a contact</p>
                    <p className="mt-0.5 text-[11.5px] text-text-tertiary">
                      {accountContacts.length === 0
                        ? 'No contacts linked to this company yet'
                        : 'Associate this deal with a specific contact from this company'}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPath('account')}
                  className="flex flex-col gap-2 rounded-[10px] border border-border bg-bg-secondary p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10">
                    <Building2 className="h-4 w-4 text-accent" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">Link directly to company</p>
                    <p className="mt-0.5 text-[11.5px] text-text-tertiary">
                      B2B deal | no specific contact required
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Deal form */}
          {path !== null && (
            <form onSubmit={handleSubmit} className="space-y-4 pt-1">
              <button
                type="button"
                onClick={() => setPath(null)}
                className="flex items-center gap-1.5 text-[12.5px] text-text-tertiary hover:text-text-primary"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>

              {/* Contact picker (only for "contact" path) */}
              {path === 'contact' && (
                <div className="space-y-1.5">
                  <Label htmlFor="opp-contact">Contact</Label>
                  <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                    <SelectTrigger id="opp-contact">
                      <SelectValue placeholder="Pick a contact…" />
                    </SelectTrigger>
                    <SelectContent>
                      {accountContacts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex flex-col">
                            <span>{displayContactName(c, 'Unnamed')}</span>
                            {(c.phone ?? c.email) && (
                              <span className="text-[11px] text-text-tertiary">
                                {c.phone ? formatPhoneDisplay(c.phone) : c.email}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="opp-title">Title</Label>
                <Input
                  id="opp-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Setup + onboarding"
                  required
                  maxLength={160}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="opp-value">Value (BRL)</Label>
                  <Input
                    id="opp-value"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="opp-stage">Stage</Label>
                  <Select value={selectedStage} onValueChange={setSelectedStage}>
                    <SelectTrigger id="opp-stage">
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

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    !title.trim() ||
                    !selectedStage ||
                    (path === 'contact' && !selectedContactId)
                  }
                >
                  {submitting ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
