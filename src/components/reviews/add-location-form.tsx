'use client'

import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import { addLocation } from '@/app/(dashboard)/reviews/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const schema = z.object({
  placeId: z.string().min(1, 'Place ID is required'),
  name: z.string().min(1, 'Name is required'),
  clientName: z.string().optional(),
  address: z.string().optional(),
  mapsUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  category: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

export function AddLocationForm() {
  const [isPending, startTransition] = useTransition()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      placeId: '',
      name: '',
      clientName: '',
      address: '',
      mapsUrl: '',
      category: '',
    },
  })

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await addLocation({
        placeId: values.placeId,
        name: values.name,
        address: values.address || undefined,
        mapsUrl: values.mapsUrl || undefined,
        category: values.category || undefined,
        clientName: values.clientName || undefined,
      })

      if (result.error) {
        toast.error('Failed to add location. Check the Place ID and try again.')
        return
      }

      toast.success('Location added.')
      form.reset()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a location</CardTitle>
        <CardDescription>Enter the Google Place ID to register a new location.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="placeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Place ID</FormLabel>
                  <FormControl>
                    <Input placeholder="ChIJ..." disabled={isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Plumbing - Riverside" disabled={isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="clientName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Corp" disabled={isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="123 Main St, Springfield, IL" disabled={isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="mapsUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Google Maps URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://maps.google.com/..." disabled={isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <FormControl>
                    <Input placeholder="Plumbing" disabled={isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3">
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Location'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
