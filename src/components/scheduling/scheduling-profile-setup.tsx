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
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
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
  const defaultTz = TIMEZONES.includes(browserTz) ? browserTz : 'UTC'

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
    <div className="rounded-lg border border-dashed border-border p-8 max-w-lg">
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
                  <span className="rounded-l border border-r-0 border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                    /book/
                  </span>
                  <Input
                    placeholder="your-name"
                    className="rounded-l-none"
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
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
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
