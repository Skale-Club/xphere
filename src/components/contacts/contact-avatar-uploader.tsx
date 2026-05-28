'use client'

/**
 * Click-to-upload avatar for a contact. Used in the chat right sidebar
 * (contact info panel) — wraps the existing Avatar primitive so the
 * fallback initials and the uploaded photo share the same circle.
 *
 * UX:
 *   - Empty state: initials inside the circle, soft camera badge in the
 *     bottom-right hinting that the avatar is clickable.
 *   - With photo: shows the image, same camera badge floats over the
 *     bottom-right corner. Right-click / long-press → remove option.
 *   - Click anywhere on the avatar opens the OS file picker.
 *   - Upload is optimistic: the local file is shown as soon as it's
 *     picked; if the server rejects it we revert and toast the error.
 *
 * Server side handled by uploadContactAvatar / removeContactAvatar in
 * src/app/(dashboard)/contacts/actions.ts (sharp → webp, stored in the
 * 'avatars' bucket under `${user.id}/contacts/...`).
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
import {
  uploadContactAvatar,
  removeContactAvatar,
} from '@/app/(dashboard)/contacts/actions'

export interface ContactAvatarUploaderProps {
  contactId: string
  /** Current avatar URL stored on the contact, or null for initials only. */
  avatarUrl: string | null
  /** Initials to render inside the fallback circle. */
  initials: string
  /** Optional size override; defaults to h-14 w-14 to match the info panel. */
  className?: string
  /** Called with the newly uploaded URL (or null after removal). */
  onAvatarChange?: (url: string | null) => void
  /**
   * When true, render a small CheckCircle in the bottom-left corner of the
   * avatar — same visual weight as the camera badge in the bottom-right,
   * mirroring its position. Read-only indicator: the verification action
   * lives outside this component (MarkVerifiedButton).
   */
  isVerified?: boolean
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

export function ContactAvatarUploader({
  contactId,
  avatarUrl,
  initials,
  className,
  onAvatarChange,
  isVerified = false,
}: ContactAvatarUploaderProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  // Local override that wins over the `avatarUrl` prop. The wrapper object
  // lets us distinguish "no override → use prop" (null) from "explicit
  // override → use this value, even if null" ({ url: null }). Needed because
  // a successful remove must render fallback initials regardless of whether
  // the parent has refetched.
  const [override, setOverride] = React.useState<{ url: string | null } | null>(null)

  const displayUrl = override ? override.url : avatarUrl

  const openPicker = React.useCallback(() => {
    if (pending) return
    fileInputRef.current?.click()
  }, [pending])

  const handleFile = React.useCallback(
    async (file: File) => {
      // Cheap client-side guards — server re-validates.
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
        const res = await uploadContactAvatar(contactId, fd)
        if (!res.ok) {
          setOverride(null) // back to parent prop
          toast.error(res.error || 'Could not upload avatar.')
          return
        }
        // Pin the canonical public URL via the override so the avatar stays
        // visible even if the parent never refetches the contact. (Earlier
        // version cleared the override after success and relied on a parent
        // refresh — when nothing was wired, the displayed image silently fell
        // back to initials.) Parent still gets onAvatarChange so other
        // surfaces can stay in sync.
        setOverride({ url: res.url })
        onAvatarChange?.(res.url)
        toast.success('Avatar updated.')
      } catch (err) {
        setOverride(null)
        toast.error(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setPending(false)
        URL.revokeObjectURL(localUrl)
        // Reset the input so picking the same file again still triggers onChange.
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [contactId, onAvatarChange],
  )

  const handleRemove = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      const res = await removeContactAvatar(contactId)
      if (!res.ok) {
        toast.error(res.error || 'Could not remove avatar.')
        return
      }
      // Explicit override → null so the fallback initials render even if the
      // parent prop hasn't refreshed yet.
      setOverride({ url: null })
      onAvatarChange?.(null)
      toast.success('Avatar removed.')
    } finally {
      setPending(false)
    }
  }, [contactId, onAvatarChange, pending])

  // The visible avatar circle + camera badge. Rendered the same in both the
  // empty-state (plain button → picker) and with-photo (dropdown trigger →
  // Change/Remove) paths so the click target looks identical to the user.
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
        <AvatarFallback className="bg-accent-muted text-accent text-[15px] font-semibold">
          {initials}
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
          title="Verified contact"
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
            aria-label="Change or remove contact avatar"
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
          aria-label="Upload contact avatar"
          className="rounded-full outline-none disabled:cursor-not-allowed"
        >
          {avatarBody}
        </button>
      )}
    </>
  )
}
