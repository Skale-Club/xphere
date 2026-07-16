'use client'

import Link from 'next/link'
import { Mail, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconWithPlusBadge } from './icon-plus-badge'

interface NewTemplateButtonProps {
  label?: string
  className?: string
  iconOnly?: boolean
  /** 'plus' (default): bare Plus icon, used inline next to a text label.
   *  'mail': Mail icon with a small Plus badge — for icon-only rails
   *  (e.g. a collapsed sidebar) where a bare Plus would be indistinguishable
   *  from other "New X" actions sitting next to it. */
  iconVariant?: 'plus' | 'mail'
}

export function NewTemplateButton({
  label = 'New template', className, iconOnly = false, iconVariant = 'plus',
}: NewTemplateButtonProps) {
  return (
    <Button asChild size="sm" className={className} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
      <Link href="/settings/email-templates/new">
        {iconVariant === 'mail' ? <IconWithPlusBadge icon={Mail} /> : <Plus className="h-3.5 w-3.5" />}
        {!iconOnly && label}
      </Link>
    </Button>
  )
}
