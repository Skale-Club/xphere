'use client'

/**
 * Generic click-to-upload avatar. Wraps the Avatar primitive so the fallback
 * (initials or a custom node) and the uploaded photo share the same circle.
 *
 * UX:
 *   - Empty state: fallback inside the circle, soft camera badge bottom-right.
 *   - With photo: shows the image + camera badge; click → Change / Remove menu.
 *   - Click anywhere on the avatar opens the OS file picker.
 *   - Optimistic: the local file shows immediately; reverts + toasts on error.
 *
 * The server side is injected via `uploadAction` / `removeAction` so the same
 * component backs contacts (uploadContactAvatar) and companies
 * (uploadAccountAvatar) — both store into the shared 'avatars' bucket.
 */

import * as React from 'react'
import { Camera, CheckCircle2, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface AvatarUploaderProps {
  /** Entity id passed straight to the upload/remove actions. */
  id: string
  /** Current avatar URL stored on the entity, or null for the fallback. */
  avatarUrl: string | null
  /** Initials rendered in the fallback circle when no `fallback` node is given. */
  initials: string
  /** Custom fallback content (e.g. an icon). Overrides `initials`. */
  fallback?: React.ReactNode
  /** className for the AvatarFallback (defaults to the accent-muted initials style). */
  fallbackClassName?: string
  /** Persists the file, returns the public URL. */
  uploadAction: (
    id: string,
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
  /** Clears the stored avatar. */
  removeAction: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Optional size override; defaults to h-14 w-14. */
  className?: string
  /** Called with the newly uploaded URL (or null after removal). */
  onAvatarChange?: (url: string | null) => void
  /** Read-only verified indicator (CheckCircle bottom-left). */
  isVerified?: boolean
  /** Accessible labels for the picker/menu triggers. */
  uploadLabel?: string
  changeLabel?: string
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

export function AvatarUploader({
  id,
  avatarUrl,
  initials,
  fallback,
  fallbackClassName,
  uploadAction,
  removeAction,
  className,
  onAvatarChange,
  isVerified = false,
  uploadLabel = 'Upload photo',
  changeLabel = 'Change or remove photo',
}: AvatarUploaderProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  // Wrapper object lets us distinguish "no override → use prop" (null) from
  // "explicit override → use this value, even if null" ({ url: null }).
  const [override, setOverride] = React.useState<{ url: string | null } | null>(null)

  const displayUrl = override ? override.url : avatarUrl

  const openPicker = React.useCallback(() => {
    if (pending) return
    fileInputRef.current?.click()
  }, [pending])

  const handleFile = React.useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error('Please pick an image file.')
        return
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error('Image is too large (max 8MB).')
        return
      }

      const localUrl = URL.createObjectURL(file)
      setOverride({ url: localUrl })
      setPending(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await uploadAction(id, fd)
        if (!res.ok) {
          setOverride(null)
          toast.error(res.error || 'Could not upload image.')
          return
        }
        setOverride({ url: res.url })
        onAvatarChange?.(res.url)
        toast.success('Image updated.')
      } catch (err) {
        setOverride(null)
        toast.error(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setPending(false)
        URL.revokeObjectURL(localUrl)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [id, uploadAction, onAvatarChange],
  )

  const handleRemove = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      const res = await removeAction(id)
      if (!res.ok) {
        toast.error(res.error || 'Could not remove image.')
        return
      }
      setOverride({ url: null })
      onAvatarChange?.(null)
      toast.success('Image removed.')
    } finally {
      setPending(false)
    }
  }, [id, removeAction, onAvatarChange, pending])

  const avatarBody = (
    <span
      className={cn(
        'group relative inline-flex shrink-0 rounded-full outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
        pending && 'cursor-wait',
      )}
    >
      <Avatar className={cn('h-14 w-14', className)}>
        {displayUrl ? <AvatarImage src={displayUrl} alt="" /> : null}
        <AvatarFallback
          className={cn(
            'bg-accent-muted text-accent text-[15px] font-semibold',
            fallbackClassName,
          )}
        >
          {fallback ?? initials}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          'pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full',
          'border-2 border-bg-primary bg-bg-tertiary text-text-secondary',
          'transition-colors group-hover:bg-accent group-hover:text-accent-foreground',
          pending && 'bg-accent text-accent-foreground',
        )}
        aria-hidden
      >
        {pending ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : (
          <Camera className="h-2.5 w-2.5" />
        )}
      </span>
      {isVerified && (
        <span
          className={cn(
            'pointer-events-none absolute -bottom-0.5 -left-0.5 flex h-5 w-5 items-center justify-center rounded-full',
            'border-2 border-bg-primary bg-emerald-500/20 text-emerald-400',
          )}
          aria-label="Verified"
          title="Verified"
        >
          <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )}
    </span>
  )

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />
      {displayUrl ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            disabled={pending}
            aria-label={changeLabel}
            className="rounded-full outline-none disabled:cursor-not-allowed"
          >
            {avatarBody}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem onClick={openPicker} disabled={pending}>
              <Camera className="mr-2 h-3.5 w-3.5" />
              Change photo
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleRemove}
              disabled={pending}
              className="text-red-500 focus:text-red-500"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Remove photo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          disabled={pending}
          aria-label={uploadLabel}
          className="rounded-full outline-none disabled:cursor-not-allowed"
        >
          {avatarBody}
        </button>
      )}
    </>
  )
}
