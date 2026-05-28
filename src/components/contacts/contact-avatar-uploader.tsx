'use client'

/**
 * Click-to-upload avatar for a contact. Thin wrapper over the generic
 * <AvatarUploader> that injects the contact-scoped server actions.
 *
 * Server side handled by uploadContactAvatar / removeContactAvatar in
 * src/app/(dashboard)/contacts/actions.ts (sharp → webp, stored in the
 * 'avatars' bucket under `${user.id}/contacts/...`).
 */

import * as React from 'react'

import { AvatarUploader } from '@/components/ui/avatar-uploader'
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
  /** Read-only verified indicator (CheckCircle bottom-left). */
  isVerified?: boolean
}

export function ContactAvatarUploader({
  contactId,
  avatarUrl,
  initials,
  className,
  onAvatarChange,
  isVerified = false,
}: ContactAvatarUploaderProps) {
  return (
    <AvatarUploader
      id={contactId}
      avatarUrl={avatarUrl}
      initials={initials}
      className={className}
      onAvatarChange={onAvatarChange}
      isVerified={isVerified}
      uploadAction={uploadContactAvatar}
      removeAction={removeContactAvatar}
      uploadLabel="Upload contact avatar"
      changeLabel="Change or remove contact avatar"
    />
  )
}
