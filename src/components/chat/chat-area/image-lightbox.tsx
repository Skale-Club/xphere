'use client'

/**
 * ImageLightbox — fullscreen image dialog with download button.
 * SEED-030: Chat Rich Messages
 */

import { Download } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'

interface ImageLightboxProps {
  src: string
  open: boolean
  onClose: () => void
}

export function ImageLightbox({ src, open, onClose }: ImageLightboxProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 flex flex-col items-center gap-2 bg-black/90 border-none">
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Full size preview"
          className="max-w-full max-h-[80vh] object-contain rounded-[8px]"
        />
        <a
          href={src}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-[6px] bg-white/10 px-3 py-1.5 text-[12px] text-white hover:bg-white/20 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </a>
      </DialogContent>
    </Dialog>
  )
}
