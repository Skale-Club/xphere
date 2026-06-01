'use client'

/**
 * MediaBlock | renders a single media attachment inside a message bubble.
 * SEED-030: Chat Rich Messages
 *
 * Supported types:
 *   - image/* → clickable thumbnail that opens ImageLightbox
 *   - audio/* → AudioPlayer
 *   - video/* → <video controls>
 *   - other   → document card with download link
 */

import { useState } from 'react'
import { FileText, Download } from 'lucide-react'
import type { MediaAttachment } from '@/types/chat'
import { AudioPlayer } from './audio-player'
import { ImageLightbox } from './image-lightbox'

interface MediaBlockProps {
  attachment: MediaAttachment
  isVisitor: boolean
}

export function MediaBlock({ attachment }: MediaBlockProps) {
  const { url, mime_type, filename, duration } = attachment
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // IMAGE
  if (mime_type.startsWith('image/')) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="block mb-1.5 cursor-zoom-in"
          aria-label="View full size image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={filename ?? 'Image'}
            className="rounded-[8px] max-w-full max-h-[240px] object-cover"
          />
        </button>
        <ImageLightbox
          src={url}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      </>
    )
  }

  // AUDIO — full-width player, no max-w constraint
  if (mime_type.startsWith('audio/')) {
    return (
      <div className="mb-1.5 w-full">
        <AudioPlayer src={url} duration={duration} />
      </div>
    )
  }

  // VIDEO
  if (mime_type.startsWith('video/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={url}
        controls
        className="rounded-[8px] max-w-full max-h-[240px] mb-1.5 block"
      />
    )
  }

  // DOCUMENT / OTHER
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-[8px] border border-border-subtle bg-bg-tertiary px-3 py-2 mb-1.5 hover:border-border-strong transition-colors no-underline"
    >
      <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
      <span className="text-[12px] text-text-primary truncate flex-1">{filename ?? 'Documento'}</span>
      <Download className="h-3.5 w-3.5 shrink-0 text-text-tertiary ml-auto" />
    </a>
  )
}
