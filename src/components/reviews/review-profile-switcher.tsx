'use client'

import { useRouter } from 'next/navigation'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePathname } from '@/lib/org/navigation'

/** Picks which business's reviews /reviews shows when the org has several. */
export function ReviewProfileSwitcher({
  currentId,
  profiles,
}: {
  currentId: string
  profiles: { id: string; label: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <Select value={currentId} onValueChange={(id) => router.push(`${pathname}?profile=${id}`)}>
      <SelectTrigger className="h-8 w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
