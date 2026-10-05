'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { usePathname } from '@/lib/org/navigation'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * Side sheet whose open state lives in the URL (`?issue=` / `?page=`), so a
 * detail can be linked to and the back button closes it. Closing drops `param`.
 */
export function DetailSheet({
  param,
  title,
  description,
  children,
}: {
  param: string
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function close() {
    const next = new URLSearchParams(searchParams.toString())
    next.delete(param)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="mt-4 space-y-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
