'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { upsertSchedulingProfile } from '@/app/(dashboard)/scheduling/_actions/scheduling-profile'

const TIMEZONES = [
  // Brazil
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Noronha',
  // North America
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Buenos_Aires',
  // Europe
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Lisbon',
  'Europe/Warsaw',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Moscow',
  // Asia/Pacific
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Kuala_Lumpur',
  'Asia/Karachi',
  'Asia/Riyadh',
  'Asia/Tehran',
  'Asia/Jerusalem',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Pacific/Auckland',
  'Pacific/Fiji',
  // Africa
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Africa/Casablanca',
  // UTC
  'UTC',
]

const schema = z.object({
  slug: z
    .string()
    .min(2, 'At least 2 characters')
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, hyphens'),
  timezone: z.string().min(1),
})

type FormValues = z.infer<typeof schema>

export function SchedulingProfileSetup() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  // Use browser timezone if it's in our list; otherwise include it dynamically
  const allTimezones = TIMEZONES.includes(browserTz)
    ? TIMEZONES
    : [browserTz, ...TIMEZONES]
  const defaultTz = browserTz

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { slug: '', timezone: defaultTz },
  })

  function handleSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await upsertSchedulingProfile(values)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Scheduling profile created')
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-8 max-w-lg w-full">
      <CalendarDays className="h-8 w-8 text-muted-foreground mb-3" />
      <h2 className="text-lg font-semibold mb-1">Set up your booking page</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Choose a username for your public booking URL and your timezone.
      </p>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <FormField control={form.control} name="slug" render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <div className="flex items-center gap-0">
                  <span className="shrink-0 whitespace-nowrap rounded-l border border-r-0 border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                    /book/
                  </span>
                  <Input
                    placeholder="your-name"
                    className="min-w-0 flex-1 rounded-l-none"
                    {...field}
                    onChange={(e) => field.onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  />
                </div>
              </FormControl>
              <FormDescription className="text-xs">Only lowercase letters, numbers and hyphens.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="timezone" render={({ field }) => (
            <FormItem>
              <FormLabel>Timezone</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  {allTimezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />

          <Button type="submit" disabled={isPending}>
            {isPending ? 'Setting up…' : 'Create booking page'}
          </Button>
        </form>
      </Form>
    </div>
  )
}
