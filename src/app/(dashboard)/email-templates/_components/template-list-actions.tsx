'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Trash2, Send, Undo2 } from 'lucide-react'
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
import { duplicateTemplate, deleteTemplate, publishTemplate, unpublishTemplate } from '../actions'

interface TemplateListActionsProps {
  templateId: string
  status: string
  /** Base path for redirects after duplicate. Defaults to '/email-templates'. */
  basePath?: string
}

export function TemplateListActions({ templateId, status, basePath = '/email-templates' }: TemplateListActionsProps) {
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
      router.push(`${basePath}/${result.data.id}`)
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

  const isPublished = status === 'published'

  function handleTogglePublish() {
    startTransition(async () => {
      const result = isPublished
        ? await unpublishTemplate(templateId)
        : await publishTemplate(templateId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(isPublished ? 'Template unpublished' : 'Template published')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-auto pt-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs gap-1"
        onClick={handleTogglePublish}
        disabled={isPending}
      >
        {isPublished ? <Undo2 className="h-3 w-3" /> : <Send className="h-3 w-3" />}
        {isPublished ? 'Unpublish' : 'Publish'}
      </Button>

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
