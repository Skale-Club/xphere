'use client'

import * as React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SortableColumnHeaderProps {
  column: string
  label: string
  className?: string
}

export function SortableColumnHeader({ column, label, className }: SortableColumnHeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const rawSort = searchParams.get('sort')
  const [activeCol, direction] = rawSort?.split(':') ?? [null, null]
  const isActive = activeCol === column

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString())
    if (isActive) {
      // Toggle direction
      const nextDir = direction === 'asc' ? 'desc' : 'asc'
      params.set('sort', `${column}:${nextDir}`)
    } else {
      // Default to desc for dates, asc for text
      const defaultDir = column === 'created_at' || column === 'updated_at' ? 'desc' : 'asc'
      params.set('sort', `${column}:${defaultDir}`)
    }
    params.delete('page')
    router.replace(`${pathname}?${params.toString()}`)
  }

  const Icon = isActive
    ? direction === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1 select-none cursor-pointer hover:text-text-primary transition-colors',
        isActive ? 'text-text-primary' : 'text-text-tertiary',
        className,
      )}
    >
      {label}
      <Icon className="h-3 w-3 shrink-0" />
    </button>
  )
}
