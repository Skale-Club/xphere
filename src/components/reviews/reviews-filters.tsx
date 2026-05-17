'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Camera, MessageSquareQuote, Star } from 'lucide-react'

import { cn } from '@/lib/utils'

const RATING_OPTIONS = [1, 2, 3, 4, 5] as const

export function ReviewsFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  const currentMin = Number.parseInt(params.get('min') ?? '1', 10)
  const withPhotos = params.get('photos') === '1'
  const withResponse = params.get('response') === '1'

  function updateParam(key: string, value: string | null) {
    const sp = new URLSearchParams(params.toString())
    if (value === null) sp.delete(key)
    else sp.set(key, value)
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-full border bg-background p-1 shadow-sm">
        {RATING_OPTIONS.map((r) => {
          const active = currentMin === r
          return (
            <button
              key={r}
              type="button"
              onClick={() => updateParam('min', r === 1 ? null : String(r))}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-all',
                active
                  ? 'bg-amber-400 text-amber-950 shadow'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {r}
              <Star className={cn('h-3 w-3', active ? 'fill-current' : '')} />
              {r === 1 ? <span className="opacity-70">+</span> : null}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => updateParam('photos', withPhotos ? null : '1')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-all shadow-sm',
          withPhotos ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'text-muted-foreground hover:bg-muted'
        )}
      >
        <Camera className="h-3 w-3" />
        With photos
      </button>

      <button
        type="button"
        onClick={() => updateParam('response', withResponse ? null : '1')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-all shadow-sm',
          withResponse ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'text-muted-foreground hover:bg-muted'
        )}
      >
        <MessageSquareQuote className="h-3 w-3" />
        Owner replied
      </button>
    </div>
  )
}
