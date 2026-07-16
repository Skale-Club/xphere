'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Layers, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createSectionTemplate } from '@/app/(dashboard)/email-templates/actions'
import { IconWithPlusBadge } from './icon-plus-badge'

interface Props {
  label?: string
  className?: string
  iconOnly?: boolean
  /** Optional folder to create the new section template inside. */
  folderId?: string | null
  /** 'plus' (default): bare Plus icon. 'layers': Layers icon with a small
   *  Plus badge — for icon-only rails where a bare Plus would be
   *  indistinguishable from other "New X" actions next to it. */
  iconVariant?: 'plus' | 'layers'
}

/**
 * Creates a blank section template and opens its standalone editor. Unlike
 * templates (which use a name-first form page), sections are created inline and
 * renamed from the editor breadcrumb — less friction for a fragment.
 */
export function NewSectionTemplateButton({
  label = 'New section', className, iconOnly = false, folderId = null, iconVariant = 'plus',
}: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <Button
      size="sm"
      className={className}
      disabled={pending}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={() =>
        start(async () => {
          const res = await createSectionTemplate('Untitled section', folderId)
          if (!res.ok) {
            toast.error(res.error ?? 'Failed to create section')
            return
          }
          router.push(`/settings/email-templates/sections/${res.data.id}`)
        })
      }
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : iconVariant === 'layers' ? (
        <IconWithPlusBadge icon={Layers} />
      ) : (
        <Plus className="h-3.5 w-3.5" />
      )}
      {!iconOnly && label}
    </Button>
  )
}
