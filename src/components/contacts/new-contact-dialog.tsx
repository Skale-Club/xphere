'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ContactForm } from './contact-form'
import { createContact } from '@/app/(dashboard)/contacts/actions'
import type { ContactFormInput } from '@/lib/contacts/zod-schemas'

interface NewContactDialogProps {
  /** Optional custom trigger. Falls back to a default "Add contact" button. */
  trigger?: React.ReactNode
  /** Pre-fill values (e.g. from a chat conversation). */
  defaultValues?: Partial<ContactFormInput>
  /** Controlled open state. If omitted, dialog manages its own state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Callback fired after a contact is successfully created or linked. */
  onCreated?: (result: { id?: string; existed: boolean }) => void
}

export function NewContactDialog({
  trigger,
  defaultValues,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onCreated,
}: NewContactDialogProps = {}) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const router = useRouter()

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next)
    else setInternalOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? (
        trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> Add contact
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            Add a person to your CRM. You can edit them anytime.
          </DialogDescription>
        </DialogHeader>
        <ContactForm
          defaultValues={defaultValues}
          onCancel={() => setOpen(false)}
          submitLabel="Create contact"
          onSubmit={async (values) => {
            const res = await createContact(values)
            if (res.error) return { error: res.error }
            if (res.existed) {
              toast.message('Linked existing contact', {
                description: 'A contact with this phone/email already existed in your CRM.',
              })
            } else {
              toast.success('Contact created')
            }
            setOpen(false)
            onCreated?.({ id: res.id, existed: res.existed ?? false })
            router.refresh()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
