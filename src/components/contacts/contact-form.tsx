'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'

import { contactSchema, type ContactFormInput } from '@/lib/contacts/zod-schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TagPicker } from '@/components/tags/tag-picker'
import { listTags, type TagRow } from '@/app/(dashboard)/settings/tags/actions'
import { AccountCombobox } from '@/components/accounts/account-combobox'
import { CustomFieldsForm } from '@/components/custom-fields/custom-fields-form'
import { cn } from '@/lib/utils'
import { splitContactName } from '@/lib/contacts/names'

interface ContactFormProps {
  defaultValues?: Partial<ContactFormInput>
  onSubmit: (values: ContactFormInput) => Promise<{ error?: string } | void>
  submitLabel?: string
  onCancel?: () => void
}

export function ContactForm({
  defaultValues,
  onSubmit,
  submitLabel = 'Save contact',
  onCancel,
}: ContactFormProps) {
  const splitName = splitContactName(defaultValues?.name)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<ContactFormInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      first_name: defaultValues?.first_name ?? splitName.firstName ?? '',
      last_name: defaultValues?.last_name ?? splitName.lastName ?? '',
      name: defaultValues?.name ?? '',
      phone: defaultValues?.phone ?? '',
      email: defaultValues?.email ?? '',
      company: defaultValues?.company ?? '',
      account_id: defaultValues?.account_id ?? null,
      notes: defaultValues?.notes ?? '',
      tags: defaultValues?.tags ?? [],
      source: defaultValues?.source ?? 'manual',
      custom_fields: (defaultValues?.custom_fields as Record<string, unknown>) ?? {},
    },
  })

  const [allTags, setAllTags] = React.useState<TagRow[]>([])
  React.useEffect(() => {
    listTags().then(setAllTags)
  }, [])

  const tagIds = (watch('tags') as string[] | undefined) ?? []

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        const res = await onSubmit(values)
        if (res && 'error' in res && res.error) {
          toast.error(res.error)
        }
      })}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="First name" htmlFor="contact-first-name" error={errors.first_name?.message}>
          <Input id="contact-first-name" placeholder="Jane" {...register('first_name')} />
        </Field>
        <Field label="Last name" htmlFor="contact-last-name" error={errors.last_name?.message}>
          <Input id="contact-last-name" placeholder="Doe" {...register('last_name')} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Phone" htmlFor="contact-phone" error={errors.phone?.message}>
          <PhoneInput
            id="contact-phone"
            value={watch('phone') ?? ''}
            onChange={(v) => setValue('phone', v, { shouldDirty: true })}
            placeholder="Phone number"
            aria-invalid={Boolean(errors.phone)}
          />
        </Field>
        <Field label="Email" htmlFor="contact-email" error={errors.email?.message}>
          <Input id="contact-email" type="email" placeholder="jane@example.com" {...register('email')} />
        </Field>
      </div>

      <Field label="Company" htmlFor="contact-company">
        <AccountCombobox
          value={(watch('account_id') as string | undefined) ?? null}
          onChange={(id, name) => {
            setValue('account_id', id, { shouldDirty: true })
            // Keep legacy company text field in sync (part of submit payload)
            if (name !== null) setValue('company', name, { shouldDirty: true })
          }}
          defaultAccountName={defaultValues?.company ?? undefined}
        />
      </Field>

      <Field label="Tags" htmlFor="contact-tags">
        <TagPicker
          allTags={allTags}
          value={tagIds}
          onChange={(ids) => setValue('tags', ids, { shouldDirty: true })}
          onTagCreated={(tag) => setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      </Field>

      <Field label="Notes" htmlFor="contact-notes" error={errors.notes?.message}>
        <Textarea
          id="contact-notes"
          rows={4}
          placeholder="Anything worth remembering about this contact"
          {...register('notes')}
        />
      </Field>

      <CustomFieldsForm
        entity="contact"
        value={(watch('custom_fields') as Record<string, unknown>) ?? {}}
        onChange={(v) => setValue('custom_fields', v, { shouldDirty: true })}
      />

      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  error,
  children,
  className,
}: {
  label: string
  htmlFor: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-[12px] font-medium text-text-secondary">
        {label}
      </Label>
      {children}
      {error && <p className="text-[11.5px] text-rose-400">{error}</p>}
    </div>
  )
}
