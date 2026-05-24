'use client'

import { useRef, useState, useTransition } from 'react'
import { ImagePlus, Loader2, Trash2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  updateCtaImage,
  setScrollImages,
  appendScrollImage,
  type LandingConfig,
} from '@/app/(admin)/admin/_actions/landing-config'

const ACCEPT = '.png,.webp,.jpg,.jpeg,.svg'

async function uploadFile(file: File, kind: 'cta' | 'scroll'): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  const res = await fetch('/api/admin/landing-image/upload', { method: 'POST', body: fd })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Upload failed')
  return json.url as string
}

export function LandingConfigForm({ config }: { config: LandingConfig }) {
  const [ctaUrl, setCtaUrl] = useState<string | null>(config.cta_image_url)
  const [scrollImages, setScrollImagesState] = useState<string[]>(config.scroll_images)
  const [isUploadingCta, setIsUploadingCta] = useState(false)
  const [isUploadingScroll, setIsUploadingScroll] = useState(false)
  const [isPending, startTransition] = useTransition()

  const ctaInputRef = useRef<HTMLInputElement>(null)
  const scrollInputRef = useRef<HTMLInputElement>(null)

  async function handleCtaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingCta(true)
    try {
      const url = await uploadFile(file, 'cta')
      setCtaUrl(url)
      await updateCtaImage(config.id, url)
      toast.success('CTA image saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploadingCta(false)
      if (ctaInputRef.current) ctaInputRef.current.value = ''
    }
  }

  function handleCtaRemove() {
    startTransition(async () => {
      try {
        await updateCtaImage(config.id, null)
        setCtaUrl(null)
        toast.success('CTA image cleared.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to clear')
      }
    })
  }

  async function handleScrollUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setIsUploadingScroll(true)
    try {
      let next = scrollImages
      for (const file of files) {
        const url = await uploadFile(file, 'scroll')
        next = await appendScrollImage(config.id, url)
      }
      setScrollImagesState(next)
      toast.success(`${files.length} image${files.length !== 1 ? 's' : ''} added.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploadingScroll(false)
      if (scrollInputRef.current) scrollInputRef.current.value = ''
    }
  }

  function handleScrollRemove(idx: number) {
    const next = scrollImages.filter((_, i) => i !== idx)
    startTransition(async () => {
      try {
        await setScrollImages(config.id, next)
        setScrollImagesState(next)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove')
      }
    })
  }

  function handleReorder(from: number, to: number) {
    if (from === to) return
    const next = [...scrollImages]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setScrollImagesState(next)
    startTransition(async () => {
      try {
        await setScrollImages(config.id, next)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save order')
      }
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <p className="text-sm font-semibold text-text-primary">CTA Background Image</p>
          <p className="text-xs text-text-tertiary">
            Shown behind the &quot;Ready to scale your business?&quot; card on the landing page. PNG, WEBP, JPEG or SVG · max 8 MB.
          </p>
        </CardHeader>
        <Separator className="bg-border-subtle" />
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="h-24 w-40 rounded-lg border border-border-subtle bg-bg-primary flex items-center justify-center shrink-0 overflow-hidden">
              {ctaUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={ctaUrl} alt="CTA preview" className="h-full w-full object-cover" />
              ) : (
                <ImagePlus className="h-5 w-5 text-text-tertiary" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-secondary truncate">
                {ctaUrl ? (
                  <span className="font-mono text-xs text-text-primary truncate block">{ctaUrl.split('/').pop()}</span>
                ) : (
                  'No CTA image set'
                )}
              </p>
              <p className="text-xs text-text-tertiary mt-1">Recommended: 1920×1080 or larger, anchored at the bottom.</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                ref={ctaInputRef}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={handleCtaUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploadingCta}
                onClick={() => ctaInputRef.current?.click()}
                className="h-8 text-xs"
              >
                {isUploadingCta ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5 mr-1.5" />
                )}
                {isUploadingCta ? 'Uploading…' : ctaUrl ? 'Replace' : 'Upload'}
              </Button>
              {ctaUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={handleCtaRemove}
                  className="h-8 w-8 p-0 hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <p className="text-sm font-semibold text-text-primary">Scroll Animation Images</p>
          <p className="text-xs text-text-tertiary">
            Add multiple images that will be sequenced into a scroll-driven animation on the landing page. Drag the handle to reorder.
          </p>
        </CardHeader>
        <Separator className="bg-border-subtle" />
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-tertiary">
              {scrollImages.length} image{scrollImages.length !== 1 ? 's' : ''} in sequence
            </p>
            <div>
              <input
                ref={scrollInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={handleScrollUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploadingScroll}
                onClick={() => scrollInputRef.current?.click()}
                className="h-8 text-xs"
              >
                {isUploadingScroll ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5 mr-1.5" />
                )}
                {isUploadingScroll ? 'Uploading…' : 'Add images'}
              </Button>
            </div>
          </div>

          {scrollImages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-subtle p-8 text-center">
              <ImagePlus className="h-6 w-6 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-secondary">No scroll-animation images yet.</p>
              <p className="text-xs text-text-tertiary mt-1">Upload several frames to build a scroll-driven sequence.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {scrollImages.map((url, idx) => (
                <li
                  key={url}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', String(idx))}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    const from = Number(e.dataTransfer.getData('text/plain'))
                    handleReorder(from, idx)
                  }}
                  className="relative group rounded-lg border border-border-subtle overflow-hidden bg-bg-primary aspect-video"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Frame ${idx + 1}`} className="h-full w-full object-cover" />
                  <div className="absolute top-1 left-1 h-5 w-5 rounded bg-black/60 text-white text-[0.65rem] flex items-center justify-center font-mono">
                    {idx + 1}
                  </div>
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      className="h-6 w-6 rounded bg-black/60 text-white flex items-center justify-center cursor-grab"
                      title="Drag to reorder"
                    >
                      <GripVertical className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScrollRemove(idx)}
                      disabled={isPending}
                      className="h-6 w-6 rounded bg-black/60 text-white hover:bg-destructive flex items-center justify-center"
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
