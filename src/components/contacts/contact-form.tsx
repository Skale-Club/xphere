'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { X } from 'lucide-react'

import { contactSchema, type ContactFormInput } from '@/lib/contacts/zod-schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

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
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<ContactFormInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      phone: defaultValues?.phone ?? '',
      email: defaultValues?.email ?? '',
      company: defaultValues?.company ?? '',
      notes: defaultValues?.notes ?? '',
      tags: defaultValues?.tags ?? [],
      source: defaultValues?.source ?? 'manual',
    },
  })

  const tags = (watch('tags') as string[] | undefined) ?? []
  const [tagDraft, setTagDraft] = React.useState('')

  function commitTag() {
    const v = tagDraft.trim()
    if (!v) return
    if (tags.includes(v)) {
      setTagDraft('')
      return
    }
    setValue('tags', [...tags, v], { shouldDirty: true })
    setTagDraft('')
  }

  function removeTag(t: string) {
    setValue(
      'tags',
      tags.filter((x) => x !== t),
      { shouldDirty: true },
    )
  }

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
      <Field label="Name" htmlFor="contact-name" error={errors.name?.message}>
        <Input id="contact-name" placeholder="Jane Doe" {...register('name')} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Phone" htmlFor="contact-phone" error={errors.phone?.message}>
          <Input id="contact-phone" placeholder="+55 11 99999-9999" {...register('phone')} />
        </Field>
        <Field label="Email" htmlFor="contact-email" error={errors.email?.message}>
          <Input id="contact-email" type="email" placeholder="jane@example.com" {...register('email')} />
        </Field>
      </div>

      <Field label="Company" htmlFor="contact-company" error={errors.company?.message}>
        <Input id="contact-company" placeholder="Acme Inc." {...register('company')} />
      </Field>

      <Field label="Tags" htmlFor="contact-tag-draft">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2.5 py-0.5 text-[11.5px] font-medium text-accent"
            >
              {t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="rounded-full hover:bg-accent/10 p-0.5 text-accent/80 hover:text-accent"
                aria-label={`Remove tag ${t}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Input
            id="contact-tag-draft"
            value={tagDraft}
            placeholder={tags.length === 0 ? 'lead, vip, hot-lead…' : 'Add tag'}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commitTag()
              }
              if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
                removeTag(tags[tags.length - 1])
              }
            }}
            onBlur={commitTag}
            className="min-w-[120px] flex-1"
          />
        </div>
      </Field>

      <Field label="Notes" htmlFor="contact-notes" error={errors.notes?.message}>
        <Textarea
          id="contact-notes"
          rows={4}
          placeholder="Anything worth remembering about this contact"
          {...register('notes')}
        />
      </Field>

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
