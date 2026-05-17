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

export function NewContactDialog() {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5" /> Add contact
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            Add a person to your CRM. You can edit them anytime.
          </DialogDescription>
        </DialogHeader>
        <ContactForm
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
            router.refresh()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
