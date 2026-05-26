'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { ContactForm } from './contact-form'
import { createContact } from '@/app/(dashboard)/contacts/actions'
import type { ContactFormInput } from '@/lib/contacts/zod-schemas'

interface NewContactPageFormProps {
  defaultValues?: Partial<ContactFormInput>
  returnTo?: string | null
}

export function NewContactPageForm({ defaultValues, returnTo }: NewContactPageFormProps) {
  const router = useRouter()

  return (
    <ContactForm
      defaultValues={defaultValues}
      submitLabel="Create contact"
      onCancel={() => router.push(returnTo ?? '/contacts')}
      onSubmit={async (values) => {
        const res = await createContact(values)
        if (res.error) return { error: res.error }
        if (res.existed) {
          if (res.matched_via === 'multi_conflict') {
            toast.warning(
              'Conflito de identidade — phone bate com um contato, email bate com outro. Revisar em /admin/contacts/conflicts',
              {
                action: {
                  label: 'Abrir',
                  onClick: () => router.push('/admin/contacts/conflicts'),
                },
              },
            )
          } else {
            // matched_via: 'phone' | 'email' | 'both_same'
            toast.message('Contato já existe', {
              description: `Vinculado ao contato existente (${res.matched_via ?? 'identidade'}).`,
              action: {
                label: 'Abrir',
                onClick: () => {
                  if (res.id) router.push(`/contacts/${res.id}`)
                },
              },
            })
          }
          // D-04: no auto-redirect, no field overwrite. Stay on the form so the toast Abrir link is actionable.
          return
        }
        toast.success('Contato criado')
        router.push(returnTo ?? `/contacts`)
        router.refresh()
      }}
    />
  )
}
