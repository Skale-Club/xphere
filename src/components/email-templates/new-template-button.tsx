'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface NewTemplateButtonProps {
  label?: string
  className?: string
  iconOnly?: boolean
}

export function NewTemplateButton({ label = 'New template', className, iconOnly = false }: NewTemplateButtonProps) {
  return (
    <Button asChild size="sm" className={className} aria-label={iconOnly ? label : undefined}>
      <Link href="/settings/email-templates/new">
        <Plus className="h-3.5 w-3.5" />
        {!iconOnly && label}
      </Link>
    </Button>
  )
}
