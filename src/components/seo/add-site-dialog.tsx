'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createSite } from '@/app/(dashboard)/seo/actions'
import { parseSiteInput } from '@/lib/seo/url'
import { SiteCrawlFields, type Schedule } from './site-form-fields'

const schema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Enter the website address')
    .refine((v) => parseSiteInput(v) !== null, 'Enter a valid website address, like example.com'),
  name: z.string().trim().max(120).optional(),
})

type FormValues = z.infer<typeof schema>

export function AddSiteDialog({ suggestedUrl, variant = 'default' }: { suggestedUrl?: string | null; variant?: 'default' | 'outline' }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [schedule, setSchedule] = React.useState<Schedule>('weekly')
  const [maxPages, setMaxPages] = React.useState(200)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { url: suggestedUrl ?? '', name: '' },
  })

  async function onSubmit(values: FormValues) {
    const res = await createSite({ url: values.url, name: values.name || undefined, schedule, maxPages })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Site added — the first audit starts within a minute')
    setOpen(false)
    reset()
    router.push(`/seo/${res.data.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add site
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="mt-0 leading-tight">Add a site to audit</DialogTitle>
          <DialogDescription>
            We crawl the site like a search engine and report what to fix. Allow the user agent “XphereBot” if the site
            uses a firewall or bot protection.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-2 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="seo-url">Website</Label>
            <Input id="seo-url" placeholder="example.com" autoFocus {...register('url')} />
            {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seo-name">Name (optional)</Label>
            <Input id="seo-name" placeholder="Defaults to the domain" {...register('name')} />
          </div>
          <SiteCrawlFields schedule={schedule} maxPages={maxPages} onScheduleChange={setSchedule} onMaxPagesChange={setMaxPages} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add and audit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
