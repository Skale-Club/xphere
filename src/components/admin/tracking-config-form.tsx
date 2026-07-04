'use client'

import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Radio } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { AdminSaveBar } from '@/components/admin/admin-save-bar'
import { savePlatformTrackingConfig } from '@/app/(admin)/admin/tracking/_actions/tracking-config'
import type { PlatformTrackingConfigRow } from '@/types/database'

const schema = z.object({
  gtm_container_id: z
    .string()
    .regex(/^GTM-[A-Z0-9]+$/i, 'Format: GTM-XXXXXXX')
    .or(z.literal('')),
  facebook_pixel_id: z
    .string()
    .regex(/^\d{10,20}$/, 'Numeric Pixel ID (10-20 digits)')
    .or(z.literal('')),
})

type FormValues = z.infer<typeof schema>

const CONVERSION_EVENTS = [
  { name: 'sign_up', description: 'A visitor completes account signup — a new Xphere org is born.' },
  { name: 'demo_start', description: 'A visitor clicks "See demo" on the landing page.' },
  { name: 'checkout_started', description: 'An org admin starts a Stripe Checkout session to subscribe.' },
  { name: 'purchase', description: 'An org returns from a successful Stripe Checkout.' },
] as const

export function TrackingConfigForm({ settings }: { settings: PlatformTrackingConfigRow | null }) {
  const [isPending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      gtm_container_id: settings?.gtm_container_id ?? '',
      facebook_pixel_id: settings?.facebook_pixel_id ?? '',
    },
  })

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await savePlatformTrackingConfig({
        gtmContainerId: values.gtm_container_id || null,
        facebookPixelId: values.facebook_pixel_id || null,
        isActive: true,
      })

      if (result.error) {
        toast.error(result.error === 'Unauthorized' ? 'Not authorized.' : 'Failed to save tracking settings.')
        return
      }

      form.reset(values)
      toast.success('Tracking settings saved')
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <p className="text-sm font-semibold text-text-primary">Google Tag Manager</p>
          </CardHeader>
          <Separator className="bg-border-subtle" />
          <CardContent className="p-4">
            <FormField
              control={form.control}
              name="gtm_container_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm text-text-secondary">Container ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="GTM-XXXXXXX" className="h-9 font-mono text-sm" />
                  </FormControl>
                  <FormDescription className="text-xs text-text-tertiary">
                    Leave blank to disable GTM. Loads on every page across the whole platform.
                  </FormDescription>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <p className="text-sm font-semibold text-text-primary">Facebook Pixel</p>
          </CardHeader>
          <Separator className="bg-border-subtle" />
          <CardContent className="p-4">
            <FormField
              control={form.control}
              name="facebook_pixel_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm text-text-secondary">Pixel ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="123456789012345" className="h-9 font-mono text-sm" />
                  </FormControl>
                  <FormDescription className="text-xs text-text-tertiary">
                    Leave blank to disable the Pixel. Found in Meta Events Manager.
                  </FormDescription>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
            <p className="text-sm font-semibold text-text-primary">Conversion events</p>
          </CardHeader>
          <Separator className="bg-border-subtle" />
          <CardContent className="p-4">
            <p className="text-xs text-text-tertiary mb-3">
              Fixed set of events fired to both GTM&rsquo;s dataLayer and the Facebook Pixel. Not
              editable — these track the acquisition funnel for new Xphere customers.
            </p>
            <div className="space-y-2.5">
              {CONVERSION_EVENTS.map((event) => (
                <div key={event.name} className="flex items-start gap-3 rounded-md border border-border-subtle bg-bg-primary px-3 py-2">
                  <code className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-xs font-mono text-text-primary">
                    {event.name}
                  </code>
                  <p className="text-xs text-text-secondary">{event.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <AdminSaveBar
          isDirty={form.formState.isDirty}
          isPending={isPending}
          asSubmit
          label="Save tracking settings"
        />
      </form>
    </Form>
  )
}
