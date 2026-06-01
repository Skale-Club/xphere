'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CustomFieldsForm } from '@/components/custom-fields/custom-fields-form'
import { createAccount } from '@/app/(dashboard)/companies/actions'
import { ACCOUNT_SIZES, type AccountInput } from '@/lib/accounts'

const EMPTY_FORM: AccountInput = {
  name: '',
  domain: '',
  website: '',
  industry: '',
  size: '',
  phone: '',
  address: '',
  notes: '',
  tags: [],
  custom_fields: {},
}

interface NewCompanyDialogProps {
  trigger?: React.ReactNode
}

export function NewCompanyDialog({ trigger }: NewCompanyDialogProps = {}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<AccountInput>(EMPTY_FORM)
  const [tagsInput, setTagsInput] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  function update<K extends keyof AccountInput>(key: K, value: AccountInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function reset() {
    setForm(EMPTY_FORM)
    setTagsInput('')
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.name?.trim()) {
      toast.error('Company name is required')
      return
    }

    setSubmitting(true)
    const tags = tagsInput
      .split(/[;,]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 50)

    const result = await createAccount({
      ...form,
      tags,
      source: 'manual',
    })

    setSubmitting(false)
    if (!result.ok) {
      toast.error('Failed to create company')
      return
    }

    toast.success('Company created')
    setOpen(false)
    reset()
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button type="button" size="sm" className="h-10 gap-2 text-[13px]">
            <Plus className="h-3.5 w-3.5" />
            Add company
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-accent" />
            New company
          </DialogTitle>
          <DialogDescription>
            Add an organization to Xphere and link contacts or deals later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Company name" htmlFor="company-name" required>
              <Input
                id="company-name"
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="Acme Inc."
                required
                maxLength={500}
              />
            </Field>
            <Field label="Domain" htmlFor="company-domain">
              <Input
                id="company-domain"
                value={form.domain ?? ''}
                onChange={(event) => update('domain', event.target.value)}
                placeholder="acme.com"
                maxLength={255}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Website" htmlFor="company-website">
              <Input
                id="company-website"
                value={form.website ?? ''}
                onChange={(event) => update('website', event.target.value)}
                placeholder="https://acme.com"
                maxLength={500}
              />
            </Field>
            <Field label="Phone" htmlFor="company-phone">
              <Input
                id="company-phone"
                value={form.phone ?? ''}
                onChange={(event) => update('phone', event.target.value)}
                placeholder="+1 555 0100"
                maxLength={40}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Industry" htmlFor="company-industry">
              <Input
                id="company-industry"
                value={form.industry ?? ''}
                onChange={(event) => update('industry', event.target.value)}
                placeholder="Technology"
                maxLength={200}
              />
            </Field>
            <Field label="Size" htmlFor="company-size">
              <Select
                value={form.size || 'none'}
                onValueChange={(value) => update('size', value === 'none' ? '' : value)}
              >
                <SelectTrigger id="company-size">
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No size</SelectItem>
                  {ACCOUNT_SIZES.map((size) => (
                    <SelectItem key={size} value={size}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Address" htmlFor="company-address">
            <Input
              id="company-address"
              value={form.address ?? ''}
              onChange={(event) => update('address', event.target.value)}
              placeholder="Street, city, state"
              maxLength={1000}
            />
          </Field>

          <Field label="Tags" htmlFor="company-tags">
            <Input
              id="company-tags"
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              placeholder="enterprise, partner"
            />
          </Field>

          <Field label="Notes" htmlFor="company-notes">
            <Textarea
              id="company-notes"
              value={form.notes ?? ''}
              onChange={(event) => update('notes', event.target.value)}
              placeholder="Anything worth remembering about this company"
              rows={3}
              maxLength={5000}
            />
          </Field>

          <CustomFieldsForm
            entity="account"
            value={(form.custom_fields as Record<string, unknown>) ?? {}}
            onChange={(value) => update('custom_fields', value)}
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !form.name?.trim()}>
              {submitting ? 'Creating...' : 'Create company'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-[12px] font-medium text-text-secondary">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </Label>
      {children}
    </div>
  )
}
