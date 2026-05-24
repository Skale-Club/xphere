'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Check } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import type { Database } from '@/types/database'

type PipelineRow = Database['public']['Tables']['pipelines']['Row']

interface PipelineSwitcherProps {
  pipelines: PipelineRow[]
  activeId: string | null
}

export function PipelineSwitcher({ pipelines, activeId }: PipelineSwitcherProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const active = pipelines.find((p) => p.id === activeId) ?? pipelines[0]

  function select(id: string) {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('pipeline', id)
    router.push(`?${sp.toString()}`)
  }

  if (pipelines.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-1 h-8">
          {active?.name ?? 'Pipeline'}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {pipelines.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => select(p.id)}>
            <span className="flex-1 truncate">{p.name}</span>
            {p.is_default && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-text-tertiary">
                default
              </span>
            )}
            {p.id === activeId && <Check className="h-3.5 w-3.5 text-accent ml-1" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
