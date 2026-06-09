'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { mapSupabaseError } from '@/lib/auth/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

const schema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type Values = z.infer<typeof schema>

const inputClass =
  'h-10 text-base md:text-sm bg-white/4 border-white/10 text-[#FAFAFA] placeholder:text-[#3F3F46] focus-visible:ring-indigo-500/40 focus-visible:border-indigo-500/50 pr-10'

export function UpdatePasswordForm() {
  const router = useRouter()
  const [show, setShow] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: { password: '', confirmPassword: '' },
  })
  const isSubmitting = form.formState.isSubmitting

  async function onSubmit(values: Values) {
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: values.password })
    if (error) {
      toast.error(mapSupabaseError(error.message))
      return
    }
    toast.success('Password updated')
    router.replace('/dashboard')
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">New password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Enter a new password"
                    disabled={isSubmitting}
                    className={inputClass}
                    {...field}
                  />
                  <button
                    type="button"
                    aria-label={show ? 'Hide password' : 'Show password'}
                    onClick={() => setShow((p) => !p)}
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-[#52525B] transition-colors hover:text-[#A1A1AA]"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FormControl>
              <FormMessage className="text-xs text-red-400" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">Confirm password</FormLabel>
              <FormControl>
                <Input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Confirm your new password"
                  disabled={isSubmitting}
                  className={inputClass}
                  {...field}
                />
              </FormControl>
              <FormMessage className="text-xs text-red-400" />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-10 w-full bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Updating&hellip;
            </>
          ) : (
            <span>Update password</span>
          )}
        </Button>
      </form>
    </Form>
  )
}
