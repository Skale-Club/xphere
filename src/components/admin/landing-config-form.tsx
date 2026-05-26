'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ImagePlus, Loader2, Trash2, Play, Pause } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  updateCtaImage,
  setScrollImages,
  appendScrollImage,
  clearScrollImages,
  type LandingConfig,
} from '@/app/(admin)/admin/_actions/landing-config'
import { SCROLL_IMAGES_LIMIT } from '@/app/(admin)/admin/_actions/landing-config-constants'

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
  const [pendingPreviews, setPendingPreviews] = useState<{ id: string; localUrl: string }[]>([])
  const [previewFrame, setPreviewFrame] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const rafRef = useRef<number | null>(null)
  const playStateRef = useRef<{ frame: number; lastTime: number; playing: boolean }>({ frame: 0, playing: false, lastTime: 0 })
  const ctaInputRef = useRef<HTMLInputElement>(null)
  const scrollInputRef = useRef<HTMLInputElement>(null)

  function drawFrame(url: string) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cached = loadedImagesRef.current.get(url)
    if (cached) {
      ctx.drawImage(cached, 0, 0, canvas.width, canvas.height)
      return
    }
    const img = new window.Image()
    img.onload = () => {
      loadedImagesRef.current.set(url, img)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.src = url
  }

  function preloadImages(urls: string[]) {
    for (const url of urls) {
      if (loadedImagesRef.current.has(url)) continue
      const img = new window.Image()
      img.onload = () => loadedImagesRef.current.set(url, img)
      img.src = url
    }
  }

  function seekFrame(idx: number, images: string[]) {
    setPreviewFrame(idx)
    playStateRef.current.frame = idx
    drawFrame(images[idx])
  }

  function stopPlay() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    playStateRef.current.playing = false
    setIsPlaying(false)
  }

  function startPlay(images: string[]) {
    if (images.length < 2) return
    stopPlay()
    playStateRef.current.playing = true
    playStateRef.current.lastTime = 0
    setIsPlaying(true)

    const FPS = 24
    const MS_PER_FRAME = 1000 / FPS

    function tick(now: number) {
      const state = playStateRef.current
      if (!state.playing) return
      if (now - state.lastTime >= MS_PER_FRAME) {
        state.lastTime = now
        const next = state.frame + 1
        if (next >= images.length) {
          stopPlay()
          return
        }
        state.frame = next
        setPreviewFrame(next)
        drawFrame(images[next])
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    if (scrollImages.length === 0) return
    preloadImages(scrollImages)
    const idx = Math.min(playStateRef.current.frame, scrollImages.length - 1)
    playStateRef.current.frame = idx
    setPreviewFrame(idx)
    // Draw after a tick so the canvas is mounted
    requestAnimationFrame(() => drawFrame(scrollImages[idx]))
    return () => { stopPlay() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollImages])

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

  async function uploadScrollFiles(rawFiles: File[]) {
    // Filter to image files only (drag-drop can include non-images)
    const files = rawFiles.filter(f => f.type.startsWith('image/'))
    if (!files.length) {
      if (rawFiles.length > 0) toast.error('No image files in selection.')
      return
    }
    const available = SCROLL_IMAGES_LIMIT - scrollImages.length
    if (available <= 0) {
      toast.error(`Limit of ${SCROLL_IMAGES_LIMIT} images reached.`)
      return
    }
    const toUpload = files.slice(0, available)
    if (toUpload.length < files.length) {
      toast.warning(`Only ${toUpload.length} of ${files.length} files will be uploaded (limit: ${SCROLL_IMAGES_LIMIT}).`)
    }

    // Show local previews immediately
    const previews = toUpload.map(file => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      localUrl: URL.createObjectURL(file),
    }))
    setPendingPreviews(prev => [...prev, ...previews])
    setIsUploadingScroll(true)

    try {
      let next = scrollImages
      for (let i = 0; i < toUpload.length; i++) {
        const url = await uploadFile(toUpload[i], 'scroll')
        next = await appendScrollImage(config.id, url)
        // Remove this specific preview as its upload completes
        const id = previews[i].id
        URL.revokeObjectURL(previews[i].localUrl)
        setPendingPreviews(prev => prev.filter(p => p.id !== id))
        setScrollImagesState(next)
      }
      toast.success(`${toUpload.length} image${toUpload.length !== 1 ? 's' : ''} added.`)
    } catch (err) {
      // Clear all remaining previews on error
      previews.forEach(p => URL.revokeObjectURL(p.localUrl))
      setPendingPreviews(prev => prev.filter(p => !previews.some(q => q.id === p.id)))
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploadingScroll(false)
    }
  }

  function handleScrollUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    uploadScrollFiles(files).finally(() => {
      if (scrollInputRef.current) scrollInputRef.current.value = ''
    })
  }

  // Drag-and-drop state for the scroll-images card
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current += 1
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragOver(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    void uploadScrollFiles(files)
  }

  function handleClearAll() {
    startTransition(async () => {
      try {
        await clearScrollImages(config.id)
        setScrollImagesState([])
        toast.success('All scroll images deleted.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete')
      }
    })
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
        <CardContent
          className={cn(
            'relative p-4 space-y-3 transition-colors',
            isDragOver && 'bg-accent/5',
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="pointer-events-none absolute inset-2 z-10 rounded-lg border-2 border-dashed border-accent bg-accent/5 flex items-center justify-center">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-primary/90 border border-accent/30">
                <ImagePlus className="h-4 w-4 text-accent" />
                <span className="text-sm text-text-primary">Drop images to add</span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-tertiary">
              {scrollImages.length} / {SCROLL_IMAGES_LIMIT} images in sequence
            </p>
            <div className="flex items-center gap-2">
              {scrollImages.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      className="h-8 text-xs hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete all
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete all scroll images?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete all {scrollImages.length} image{scrollImages.length !== 1 ? 's' : ''} from storage and the database. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleClearAll}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete all
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
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
                disabled={isUploadingScroll || scrollImages.length >= SCROLL_IMAGES_LIMIT}
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

          {scrollImages.length > 0 ? (
            <div className="rounded-lg border border-border-subtle overflow-hidden bg-black">
              {/* Canvas preview — perfectly smooth, no CSS transitions */}
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  width={1920}
                  height={1080}
                  className="w-full aspect-video block"
                />
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-[0.65rem] font-mono tabular-nums">
                  {previewFrame + 1} / {scrollImages.length}
                </div>
              </div>

              {/* Slider + play controls */}
              <div className="flex items-center gap-3 px-4 py-3 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={isPlaying ? stopPlay : () => startPlay(scrollImages)}
                  disabled={scrollImages.length < 2}
                  className="h-7 w-7 shrink-0 rounded flex items-center justify-center bg-bg-secondary hover:bg-bg-hover border border-border-subtle text-text-secondary disabled:opacity-40 transition-colors"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <Slider
                  min={0}
                  max={scrollImages.length - 1}
                  step={1}
                  value={[previewFrame]}
                  onValueChange={([v]) => { stopPlay(); seekFrame(v, scrollImages) }}
                  className="flex-1"
                />
              </div>
            </div>
          ) : pendingPreviews.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-subtle p-8 text-center">
              <ImagePlus className="h-6 w-6 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-secondary">No scroll-animation images yet.</p>
              <p className="text-xs text-text-tertiary mt-1">Upload several frames to build a scroll-driven sequence.</p>
            </div>
          ) : null}

          {/* Pending upload previews */}
          {pendingPreviews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingPreviews.map(({ id, localUrl }) => (
                <div key={id} className="relative rounded-lg border border-border-subtle overflow-hidden bg-bg-primary w-20 aspect-video shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={localUrl} alt="Uploading…" className="h-full w-full object-cover opacity-50" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 text-white animate-spin" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
