'use client'

import { useState } from 'react'
import { Variable } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Canonical merge tags surfaced by the picker (Phase 3 — email-builder-hardening).
 * Kept in sync by hand with the sample values in email-template-editor.tsx's
 * SAMPLE_VARS (used by the preview dialog's "Sample data" toggle) — both are
 * small, static lists, not worth deriving from one another.
 */
export const MERGE_TAGS = [
  { tag: 'contact.first_name', label: 'First name' },
  { tag: 'contact.last_name', label: 'Last name' },
  { tag: 'contact.name', label: 'Full name' },
  { tag: 'contact.email', label: 'Email' },
  { tag: 'contact.phone', label: 'Phone' },
  { tag: 'contact.company', label: 'Company' },
  { tag: 'org.name', label: 'Organization name' },
] as const

export function mergeTagToken(tag: string): string {
  return `{{ ${tag} }}`
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Best-effort — clipboard API can be unavailable (insecure context,
    // permissions policy). Insertion into the field already happened, so a
    // failed copy is not worth surfacing to the user.
  }
}

/**
 * Popover listing the canonical merge tags. `onInsert` receives the
 * fully-formed `{{ tag }}` token; the caller decides how to splice it into
 * its own field — see `insertTokenAtCursor` below for <input>-backed fields,
 * and the text/heading block inspectors for the contentEditable-backed
 * append fallback. Every insertion also copies the token to the clipboard,
 * so it can be pasted into a field this picker isn't wired into yet.
 */
export function MergeTagPicker({
  onInsert,
  className,
  title = 'Insert merge tag',
}: {
  onInsert: (token: string) => void
  className?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            className,
          )}
        >
          <Variable className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Merge tags
        </p>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {MERGE_TAGS.map(({ tag, label }) => (
            <button
              key={tag}
              type="button"
              className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
              onClick={() => {
                const token = mergeTagToken(tag)
                onInsert(token)
                void copyToClipboard(token)
                setOpen(false)
              }}
            >
              <span className="font-medium">{label}</span>
              <span className="text-[10px] text-muted-foreground">{mergeTagToken(tag)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Insert `token` at the current cursor position of a controlled
 * <input>/<textarea>. Falls back to appending when there's no live selection
 * (e.g. the field never had focus, or the ref isn't attached). Returns the
 * next field value and the cursor offset to restore after the state update
 * lands (callers `requestAnimationFrame` + `setSelectionRange`, mirroring the
 * `runWithFreshDoc` blur/rAF pattern already used elsewhere in this editor).
 */
export function insertTokenAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
  token: string,
): { value: string; cursor: number } {
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? value.length
  const next = value.slice(0, start) + token + value.slice(end)
  return { value: next, cursor: start + token.length }
}
