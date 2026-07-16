'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { MoreHorizontal, Star, Copy, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setDefaultSignature, duplicateSignature, deleteSignature } from '../actions'

interface Props {
  signatureId: string
  isDefault: boolean
}

export function SignatureListActions({ signatureId, isDefault }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        toast.error(res.error ?? 'Something went wrong')
        return
      }
      toast.success(success)
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isPending}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
          <span className="sr-only">Signature actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={() =>
            run(() => setDefaultSignature(signatureId, !isDefault), isDefault ? 'Default cleared' : 'Set as default')
          }
        >
          <Star className={`mr-2 h-3.5 w-3.5 ${isDefault ? 'fill-current text-amber-400' : ''}`} />
          {isDefault ? 'Clear default' : 'Set as default'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            run(async () => {
              const res = await duplicateSignature(signatureId)
              return res
            }, 'Signature duplicated')
          }
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            if (!confirm('Delete this signature? This cannot be undone.')) return
            run(() => deleteSignature(signatureId), 'Signature deleted')
          }}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
