'use client'

import { useRef, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ImagePlus, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { AdminSaveBar } from '@/components/admin/admin-save-bar'
import {
  updateSeoConfig,
  updateFaviconUrl,
  updateOgImageUrl,
} from '@/app/(admin)/admin/_actions/seo-config'
import type { SeoConfig } from '@/app/(admin)/admin/_actions/seo-config'

const schema = z.object({
  site_title: z.string().min(1, 'Required'),
  title_template: z.string().min(1, 'Required').refine(v => v.includes('%s'), {
    message: 'Must include %s as a placeholder for the page title',
  }),
  description: z.string().min(10, 'At least 10 characters').max(160, 'Max 160 characters for SEO'),
  keywords_raw: z.string(),
})

type FormValues = z.infer<typeof schema>

export function SeoConfigForm({ config }: { config: SeoConfig }) {
  const [isPending, startTransition] = useTransition()
  const [faviconUrl, setFaviconUrl] = useState<string | null>(config.favicon_url ?? null)
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(null)
  const [ogImageUrl, setOgImageUrl] = useState<string | null>(config.og_image_url ?? null)
  const [ogPreviewUrl, setOgPreviewUrl] = useState<string | null>(null)
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false)
  const [isUploadingOg, setIsUploadingOg] = useState(false)
  const faviconInputRef = useRef<HTMLInputElement>(null)
  const ogInputRef = useRef<HTMLInputElement>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      site_title: config.site_title,
      title_template: config.title_template,
      description: config.description,
      keywords_raw: config.keywords.join(', '),
    },
  })

  async function handleFaviconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const previewUrl = URL.createObjectURL(file)
    setFaviconPreviewUrl(previewUrl)
    setIsUploadingFavicon(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/favicon/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      const newUrl = json.url as string
      setFaviconUrl(newUrl)
      await updateFaviconUrl(config.id, newUrl)
      toast.success('Favicon saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploadingFavicon(false)
      setFaviconPreviewUrl(null)
      URL.revokeObjectURL(previewUrl)
      if (faviconInputRef.current) faviconInputRef.current.value = ''
    }
  }

  function handleFaviconRemove() {
    startTransition(async () => {
      try {
        await updateFaviconUrl(config.id, null)
        setFaviconUrl(null)
        toast.success('Favicon removed.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove favicon')
      }
    })
  }

  async function handleOgImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const previewUrl = URL.createObjectURL(file)
    setOgPreviewUrl(previewUrl)
    setIsUploadingOg(true)

    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/og-image/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')

      const newUrl = json.url as string
      await updateOgImageUrl(config.id, newUrl)
      setOgImageUrl(newUrl)
      toast.success('OG image saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploadingOg(false)
      setOgPreviewUrl(null)
      URL.revokeObjectURL(previewUrl)
      if (ogInputRef.current) ogInputRef.current.value = ''
    }
  }

  function handleOgImageRemove() {
    startTransition(async () => {
      try {
        await updateOgImageUrl(config.id, null)
        setOgImageUrl(null)
        toast.success('OG image removed.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove OG image')
      }
    })
  }

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      try {
        const keywords = values.keywords_raw
          .split(',')
          .map(k => k.trim())
          .filter(Boolean)

        await updateSeoConfig(config.id, {
          site_title: values.site_title,
          title_template: values.title_template,
          description: values.description,
          og_image_url: ogImageUrl,
          favicon_url: faviconUrl,
          keywords,
        })

        form.reset(values)
        toast.success('SEO settings saved')
      } catch {
        toast.error('Failed to save SEO settings. Try again.')
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <p className="text-sm font-semibold text-text-primary">Site Identity</p>
          </CardHeader>
          <Separator className="bg-border-subtle" />
          <CardContent className="p-4 space-y-4">
            <FormField
              control={form.control}
              name="site_title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm text-text-secondary">Site Name</FormLabel>
                  <FormControl>
                    <Input {...field} className="h-9" />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title_template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm text-text-secondary">Title Template</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="%s | Xphere" className="h-9 font-mono text-sm" />
                  </FormControl>
                  <FormDescription className="text-xs text-text-tertiary">
                    Use %s as a placeholder for the page title. E.g. &quot;%s | Xphere&quot;
                  </FormDescription>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <p className="text-sm font-semibold text-text-primary">Favicon</p>
          </CardHeader>
          <Separator className="bg-border-subtle" />
          <CardContent className="p-4">
            <input
              ref={faviconInputRef}
              type="file"
              accept=".png,.ico,.svg,.webp,.jpg,.jpeg"
              className="sr-only"
              onChange={handleFaviconChange}
            />

            <div className="group relative flex min-h-20 items-center gap-4 overflow-hidden rounded-lg border border-border-subtle bg-bg-primary p-3 pr-14 transition-colors hover:border-border">
              <button
                type="button"
                disabled={isUploadingFavicon || isPending}
                onClick={() => faviconInputRef.current?.click()}
                className="absolute inset-0 z-10 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 disabled:cursor-wait"
                aria-label={faviconUrl ? 'Replace favicon' : 'Upload favicon'}
              />

              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-subtle bg-bg-secondary">
                {(faviconPreviewUrl || faviconUrl) ? (
                  <Image
                    src={faviconPreviewUrl || faviconUrl || ''}
                    alt="Favicon preview"
                    width={36}
                    height={36}
                    className="object-contain"
                    unoptimized
                  />
                ) : (
                  <ImagePlus className="h-5 w-5 text-text-tertiary" />
                )}

                {!isUploadingFavicon && (faviconPreviewUrl || faviconUrl) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <RefreshCw className="h-4 w-4" />
                  </div>
                )}

                {isUploadingFavicon && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65 text-white backdrop-blur-[1px]">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-text-primary">
                  {faviconPreviewUrl
                    ? 'Uploading new favicon…'
                    : faviconUrl
                      ? faviconUrl.split('/').pop()
                      : 'Upload favicon'}
                </p>
                <p className="mt-1 text-xs text-text-tertiary">
                  {isUploadingFavicon
                    ? 'Saving image…'
                    : 'PNG, ICO, SVG or WEBP · max 2 MB · recommended 32×32 px'}
                </p>
              </div>

              {faviconUrl && !isUploadingFavicon && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={isPending}
                  onClick={handleFaviconRemove}
                  className="absolute right-3 top-1/2 z-20 h-8 w-8 -translate-y-1/2 hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Remove favicon"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <p className="text-sm font-semibold text-text-primary">Meta Tags</p>
          </CardHeader>
          <Separator className="bg-border-subtle" />
          <CardContent className="p-4 space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm text-text-secondary">
                    Default Description
                    <span className="ml-2 text-text-tertiary font-normal">({(field.value ?? '').length}/160)</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} className="h-9" />
                  </FormControl>
                  <FormDescription className="text-xs text-text-tertiary">
                    Used as the meta description on public pages and Open Graph previews.
                  </FormDescription>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-text-secondary">Open Graph Image</p>
                <p className="mt-1 text-xs text-text-tertiary">
                  Recommended: 1200×630 px · PNG, JPG or WEBP · max 8 MB
                </p>
              </div>

              <input
                ref={ogInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={handleOgImageChange}
              />

              <div className="group relative aspect-[1200/630] w-full max-w-2xl overflow-hidden rounded-lg border border-border-subtle bg-bg-primary">
                {(ogPreviewUrl || ogImageUrl) ? (
                  <Image
                    src={ogPreviewUrl || ogImageUrl || ''}
                    alt="Open Graph preview"
                    fill
                    sizes="(max-width: 768px) 100vw, 672px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.04),transparent_45%)]" />
                )}

                <button
                  type="button"
                  disabled={isUploadingOg || isPending}
                  onClick={() => ogInputRef.current?.click()}
                  className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/0 transition-colors hover:bg-black/55 focus-visible:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 disabled:cursor-wait"
                  aria-label={ogImageUrl ? 'Replace Open Graph image' : 'Upload Open Graph image'}
                >
                  {!ogImageUrl && !ogPreviewUrl && (
                    <span className="flex flex-col items-center gap-2 text-text-tertiary transition-colors group-hover:text-white">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-bg-secondary">
                        <Upload className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-medium">Upload OG image</span>
                    </span>
                  )}

                  {(ogImageUrl || ogPreviewUrl) && !isUploadingOg && (
                    <span className="flex translate-y-1 items-center gap-2 rounded-full border border-white/20 bg-black/70 px-3 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur-sm transition-all group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
                      <RefreshCw className="h-3.5 w-3.5" />
                      Replace image
                    </span>
                  )}
                </button>

                {isUploadingOg && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/65 text-white backdrop-blur-[2px]">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-sm font-medium">Uploading image…</span>
                    <span className="text-xs text-white/65">This will only take a moment</span>
                  </div>
                )}

                {ogImageUrl && !isUploadingOg && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={isPending}
                    onClick={handleOgImageRemove}
                    className="absolute right-2 top-2 z-20 h-8 w-8 border-white/15 bg-black/65 text-white opacity-0 backdrop-blur-sm transition-opacity hover:border-destructive/50 hover:bg-destructive hover:text-white group-hover:opacity-100 group-focus-within:opacity-100"
                    aria-label="Remove Open Graph image"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <p className="text-xs text-text-tertiary">
                Click the image to replace it. Used in link previews on X, Slack and WhatsApp.
              </p>
            </div>

            <FormField
              control={form.control}
              name="keywords_raw"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm text-text-secondary">Keywords</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="AI operations, agency platform, workflow automation"
                      className="h-9"
                    />
                  </FormControl>
                  <FormDescription className="text-xs text-text-tertiary">
                    Comma-separated. Minimal SEO impact today but useful for internal tagging.
                  </FormDescription>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <AdminSaveBar
          isDirty={form.formState.isDirty}
          isPending={isPending}
          asSubmit
          label="Save SEO settings"
        />
      </form>
    </Form>
  )
}
