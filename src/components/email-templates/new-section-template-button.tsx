'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createReusableBlock } from '@/app/(dashboard)/email-templates/actions'

interface Props {
  label?: string
  className?: string
  iconOnly?: boolean
  /** Optional folder to create the new section template inside. */
  folderId?: string | null
}

/**
 * Creates a blank section template and opens its standalone editor. Unlike
 * templates (which use a name-first form page), sections are created inline and
 * renamed from the editor breadcrumb — less friction for a fragment.
 */
export function NewSectionTemplateButton({ label = 'New section', className, iconOnly = false, folderId = null }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <Button
      size="sm"
      className={className}
      disabled={pending}
      aria-label={iconOnly ? label : undefined}
      onClick={() =>
        start(async () => {
          const res = await createReusableBlock('Untitled section', folderId)
          if (!res.ok) {
            toast.error(res.error ?? 'Failed to create section')
            return
          }
          router.push(`/settings/email-templates/sections/${res.data.id}`)
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
      {!iconOnly && label}
    </Button>
  )
}
