'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TemplateComposerDialog } from '@/components/integrations/whatsapp/template-composer-dialog'

export function CreateTemplateButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Create Template
      </Button>
      <TemplateComposerDialog open={open} onOpenChange={setOpen} onCreated={() => router.refresh()} />
    </>
  )
}
