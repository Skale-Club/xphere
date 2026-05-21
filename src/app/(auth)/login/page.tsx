'use client'

import * as React from 'react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, Zap, Users, Globe, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'

import { createClient } from '@/lib/supabase/client'
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

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type LoginFormValues = z.infer<typeof loginSchema>

function mapSupabaseError(message: string): string {
  if (message.includes('Invalid login credentials')) {
    return 'Invalid email or password. Check your credentials and try again.'
  }
  if (message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
    return 'Unable to connect. Check your internet connection and try again.'
  }
  if (message.toLowerCase().includes('disabled') || message.toLowerCase().includes('banned')) {
    return 'This account has been disabled. Contact your administrator.'
  }
  return message
}

const bullets = [
  { icon: Zap, text: 'Route AI tool calls to any business action' },
  { icon: Users, text: 'Full CRM | contacts, companies, pipeline' },
  { icon: Globe, text: 'Multi-channel inbox | voice, chat, WhatsApp' },
]

export default function LoginPage() {
  const router = useRouter()
  const [authError, setAuthError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
    defaultValues: { email: '', password: '' },
  })

  async function handleGoogleSignIn() {
    const supabase = createClient()
    const origin = typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL ?? ''
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/auth/callback?next=/dashboard` },
    })
    if (error) setAuthError(mapSupabaseError(error.message))
  }

  async function onSubmit(values: LoginFormValues) {
    setAuthError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      })
      if (error) {
        setAuthError(mapSupabaseError(error.message))
        return
      }
      router.refresh()
      router.push('/dashboard')
    } catch {
      setAuthError('Unable to connect. Check your internet connection and try again.')
    }
  }

  const isSubmitting = form.formState.isSubmitting

  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => { setMounted(true) }, [])
  const urlError = mounted ? new URLSearchParams(window.location.search).get('error') : null

  return (
    <div className="flex w-full min-h-screen">
      {/* Left panel | brand */}
      <div className="hidden lg:flex lg:w-[55%] relative flex-col justify-between p-12 overflow-hidden bg-[#0D0D10]">
        {/* Grid */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        {/* Glow */}
        <div
          aria-hidden
          className="absolute top-[-10%] left-[-10%] w-[600px] h-[500px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.10) 0%, transparent 70%)' }}
        />

        <div className="relative z-10 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/pwa/icons/32" alt="" width={22} height={22} className="rounded-[6px]" />
          <span className="font-semibold text-sm text-[#FAFAFA] tracking-tight">Xphere</span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10"
        >
          <h2 className="text-[2rem] font-semibold leading-[1.15] tracking-[-0.025em] text-[#FAFAFA] mb-4">
            The AI backbone<br />for modern agencies.
          </h2>
          <p className="text-[#71717A] text-[0.9375rem] mb-8 leading-relaxed max-w-sm">
            One platform to run AI assistants, automate workflows, and manage every client interaction.
          </p>

          <div className="space-y-3">
            {bullets.map(({ icon: Icon, text }, i) => (
              <motion.div
                key={text}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.2 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-3"
              >
                <div className="h-7 w-7 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                  <Icon className="h-3.5 w-3.5 text-indigo-400" />
                </div>
                <span className="text-[0.875rem] text-[#A1A1AA]">{text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <div className="relative z-10">
          <p className="text-[0.75rem] text-[#3F3F46]">© {new Date().getFullYear()} Skale Club</p>
        </div>
      </div>

      {/* Right panel | form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12 bg-[#08090A]">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[380px]"
        >
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/api/pwa/icons/32" alt="" width={22} height={22} className="rounded-[6px]" />
            <span className="font-semibold text-sm text-[#FAFAFA]">Xphere</span>
          </div>

          <div className="mb-7">
            <h1 className="text-[1.5rem] font-semibold tracking-[-0.02em] text-[#FAFAFA]">Welcome back</h1>
            <p className="text-[0.875rem] text-[#71717A] mt-1">Sign in to your workspace</p>
          </div>

          {/* Google */}
          <Button
            type="button"
            variant="outline"
            className="w-full mb-4 h-10 border-white/10 bg-white/4 text-[#FAFAFA] hover:bg-white/8 hover:border-white/20 text-sm"
            onClick={handleGoogleSignIn}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </Button>

          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/8" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#08090A] px-2 text-[#3F3F46]">or</span>
            </div>
          </div>

          {/* Error banners */}
          {urlError === 'not_invited' && (
            <div role="alert" className="text-sm text-red-400 mb-4 p-3 rounded-lg bg-red-500/8 border border-red-500/20">
              You have not been invited to any organization. Ask your admin to invite you.
            </div>
          )}
          {urlError && urlError !== 'not_invited' && urlError !== '' && (
            <div role="alert" className="text-sm text-red-400 mb-4 p-3 rounded-lg bg-red-500/8 border border-red-500/20">
              Sign-in failed. Please try again or use email/password.
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoFocus
                        autoComplete="email"
                        disabled={isSubmitting}
                        className="h-10 bg-white/4 border-white/10 text-[#FAFAFA] placeholder:text-[#3F3F46] focus-visible:ring-indigo-500/40 focus-visible:border-indigo-500/50"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          disabled={isSubmitting}
                          className="h-10 pr-10 bg-white/4 border-white/10 text-[#FAFAFA] placeholder:text-[#3F3F46] focus-visible:ring-indigo-500/40 focus-visible:border-indigo-500/50"
                          {...field}
                        />
                        <button
                          type="button"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          onClick={() => setShowPassword(p => !p)}
                          className="absolute inset-y-0 right-0 flex items-center px-3 text-[#52525B] hover:text-[#A1A1AA] transition-colors"
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              {authError && (
                <div role="alert" className="text-sm text-red-400 p-3 rounded-lg bg-red-500/8 border border-red-500/20">
                  {authError}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-10 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </Form>
        </motion.div>
      </div>
    </div>
  )
}
