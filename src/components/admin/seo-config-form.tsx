'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { updateSeoConfig } from '@/app/(admin)/admin/_actions/seo-config'
import type { SeoConfig } from '@/app/(admin)/admin/_actions/seo-config'

const schema = z.object({
  site_title: z.string().min(1, 'Required'),
  title_template: z.string().min(1, 'Required').refine(v => v.includes('%s'), {
    message: 'Must include %s as a placeholder for the page title',
  }),
  description: z.string().min(10, 'At least 10 characters').max(160, 'Max 160 characters for SEO'),
  og_image_url: z.string().url('Must be a valid URL').or(z.literal('')).nullable(),
  keywords_raw: z.string(),
})

type FormValues = z.infer<typeof schema>

export function SeoConfigForm({ config }: { config: SeoConfig }) {
  const [isPending, startTransition] = useTransition()
  const [lastSaved, setLastSaved] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      site_title: config.site_title,
      title_template: config.title_template,
      description: config.description,
      og_image_url: config.og_image_url ?? '',
      keywords_raw: config.keywords.join(', '),
    },
  })

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
          og_image_url: values.og_image_url || null,
          keywords,
        })

        setLastSaved(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
        toast.success('SEO settings saved')
      } catch {
        toast.error('Failed to save SEO settings. Try again.')
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Card className="bg-[#111113] border-[#2A2A2F]">
          <CardHeader className="pb-3 pt-4 px-4">
            <p className="text-sm font-semibold text-[#FAFAFA]">Site Identity</p>
          </CardHeader>
          <Separator className="bg-[#2A2A2F]" />
          <CardContent className="p-4 space-y-4">
            <FormField
              control={form.control}
              name="site_title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">Site Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="h-9 bg-[#0A0A0B] border-[#2A2A2F] text-[#FAFAFA] focus-visible:ring-red-500/30"
                    />
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title_template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">Title Template</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="%s | Xphere"
                      className="h-9 bg-[#0A0A0B] border-[#2A2A2F] text-[#FAFAFA] font-mono text-sm focus-visible:ring-red-500/30"
                    />
                  </FormControl>
                  <FormDescription className="text-[0.75rem] text-[#52525B]">
                    Use %s as a placeholder for the page title. E.g. "%s | Xphere"
                  </FormDescription>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card className="bg-[#111113] border-[#2A2A2F]">
          <CardHeader className="pb-3 pt-4 px-4">
            <p className="text-sm font-semibold text-[#FAFAFA]">Meta Tags</p>
          </CardHeader>
          <Separator className="bg-[#2A2A2F]" />
          <CardContent className="p-4 space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">
                    Default Description
                    <span className="ml-2 text-[#52525B] font-normal">({(field.value ?? '').length}/160)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="h-9 bg-[#0A0A0B] border-[#2A2A2F] text-[#FAFAFA] focus-visible:ring-red-500/30"
                    />
                  </FormControl>
                  <FormDescription className="text-[0.75rem] text-[#52525B]">
                    Used as the meta description on public pages and Open Graph previews.
                  </FormDescription>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="og_image_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">OG Image URL</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="https://xphere.app/og-image.png"
                      className="h-9 bg-[#0A0A0B] border-[#2A2A2F] text-[#FAFAFA] placeholder:text-[#3F3F46] focus-visible:ring-red-500/30"
                    />
                  </FormControl>
                  <FormDescription className="text-[0.75rem] text-[#52525B]">
                    Recommended: 1200×630px. Shown in link previews on Twitter, Slack, WhatsApp.
                  </FormDescription>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="keywords_raw"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">Keywords</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="AI operations, agency platform, workflow automation"
                      className="h-9 bg-[#0A0A0B] border-[#2A2A2F] text-[#FAFAFA] placeholder:text-[#3F3F46] focus-visible:ring-red-500/30"
                    />
                  </FormControl>
                  <FormDescription className="text-[0.75rem] text-[#52525B]">
                    Comma-separated. Minimal SEO impact today but useful for internal tagging.
                  </FormDescription>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex items-center justify-between pt-1">
          {lastSaved ? (
            <p className="text-[0.75rem] text-[#52525B]">Saved at {lastSaved}</p>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            disabled={isPending}
            className="bg-red-600 hover:bg-red-700 text-white h-9 px-5 text-sm"
          >
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save SEO Settings'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
