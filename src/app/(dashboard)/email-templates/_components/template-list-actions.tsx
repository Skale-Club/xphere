'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { duplicateTemplate, deleteTemplate } from '../actions'

interface TemplateListActionsProps {
  templateId: string
}

export function TemplateListActions({ templateId }: TemplateListActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateTemplate(templateId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Template duplicated')
      router.push(`/email-templates/${result.data.id}`)
    })
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteTemplate(templateId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Template deleted')
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-1 mt-auto pt-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs gap-1"
        onClick={handleDuplicate}
        disabled={isPending}
      >
        <Copy className="h-3 w-3" />
        Duplicate
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
            disabled={isPending}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The template and all its data will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
