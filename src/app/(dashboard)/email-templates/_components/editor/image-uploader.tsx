'use client'

import { useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Upload, Loader2, Trash2, ImageOff, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const PLACEHOLDER_HINT = 'placehold.co'
const MAX_SIZE_MB = 10

/**
 * Reusable image uploader for the email editor. Upload is the primary path
 * (drag-and-drop or browse); pasting a URL is a de-emphasised "advanced" escape
 * hatch for external CDN images. On success `onChange` receives the public URL
 * of the stored object (email-assets bucket).
 */
export function ImageUploader({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (url: string) => void
  label?: string
}) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showUrl, setShowUrl] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasImage = Boolean(value) && !value.includes(PLACEHOLDER_HINT)

  const upload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error('Please choose an image file.')
        return
      }
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        toast.error(`Image is too large (max ${MAX_SIZE_MB} MB).`)
        return
      }
      setUploading(true)
      try {
        const body = new FormData()
        body.append('file', file)
        const res = await fetch('/api/email-templates/upload', { method: 'POST', body })
        const json = (await res.json()) as { url?: string; error?: string }
        if (!res.ok || !json.url) {
          toast.error(json.error ?? 'Upload failed')
          return
        }
        onChange(json.url)
        toast.success('Image uploaded')
      } catch {
        toast.error('Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [onChange],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void upload(file)
    },
    [upload],
  )

  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}

      {hasImage ? (
        <div className="group relative overflow-hidden rounded-md border border-border bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="max-h-40 w-full object-contain" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-100"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Replace
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex items-center gap-1.5 rounded bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-zinc-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          disabled={uploading}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-3 py-6 text-center transition-colors',
            dragOver
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/40',
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="h-5 w-5" />
              <span className="text-xs font-medium">Click or drop an image</span>
              <span className="text-[10px]">PNG, JPG, GIF, WebP, SVG · up to {MAX_SIZE_MB} MB</span>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
          e.target.value = '' // allow re-selecting the same file
        }}
      />

      {/* Advanced: paste an external URL (kept subtle — upload is the main path). */}
      <div>
        <button
          type="button"
          onClick={() => setShowUrl((s) => !s)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <Link2 className="h-3 w-3" />
          {showUrl ? 'Hide URL field' : 'Or paste an image URL'}
        </button>
        {showUrl && (
          <input
            type="text"
            value={hasImage ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…"
            className="mt-1 h-7 w-full rounded border border-border bg-background px-2 text-xs"
          />
        )}
      </div>

      {!hasImage && !uploading && (
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <ImageOff className="h-3 w-3" /> No image yet
        </p>
      )}
    </div>
  )
}
