'use client'

import * as React from 'react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2, ArrowRight, ArrowLeft, UserPlus } from 'lucide-react'
import { Turnstile } from '@marsidev/react-turnstile'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { mapSupabaseError, authErrorCodeToMessage } from '@/lib/auth/errors'
import { signInWithEmail, signUpWithEmail } from '@/actions/auth'

export type AuthMode = 'signin' | 'signup'
export type AuthView = 'step1' | 'step2' | 'reset'

export interface LoginDialogProps {
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  initialMode?: AuthMode
  initialView?: AuthView
}

const emailSchema = z.object({
  email: z.string().email('Enter a valid email'),
})

const passwordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const signUpPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type EmailValues = z.infer<typeof emailSchema>
type SignInPasswordValues = z.infer<typeof passwordSchema>
type SignUpPasswordValues = z.infer<typeof signUpPasswordSchema>

const inputClass =
  'h-10 text-base md:text-sm bg-white/4 border-white/10 text-[#FAFAFA] placeholder:text-[#3F3F46] focus-visible:ring-indigo-500/40 focus-visible:border-indigo-500/50'
const inputWithIconClass = `${inputClass} pr-10`

function PasswordInput({
  disabled,
  autoComplete,
  placeholder,
  field,
}: {
  disabled: boolean
  autoComplete: string
  placeholder?: string
  field: React.InputHTMLAttributes<HTMLInputElement>
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        disabled={disabled}
        className={inputWithIconClass}
        {...field}
      />
      <button
        type="button"
        aria-label={show ? 'Hide password' : 'Show password'}
        onClick={() => setShow((p) => !p)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-[#52525B] hover:text-[#A1A1AA] transition-colors"
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

function GoogleButton({ onError }: { onError: (msg: string) => void }) {
  async function handleClick() {
    const supabase = createClient()
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : process.env.NEXT_PUBLIC_SITE_URL ?? ''
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/auth/callback?next=/dashboard` },
    })
    if (error) onError(mapSupabaseError(error.message))
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full mb-4 h-10 border-white/10 bg-white/4 text-[#FAFAFA] hover:bg-white/8 hover:border-white/20 text-sm"
      onClick={handleClick}
    >
      <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
      Continue with Google
    </Button>
  )
}

function Divider() {
  return (
    <div className="relative mb-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-white/8" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-[#08090A] px-2 text-[#3F3F46]">or</span>
      </div>
    </div>
  )
}

function AuthError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="text-sm text-red-400 p-3 rounded-lg bg-red-500/8 border border-red-500/20"
    >
      {message}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Step 1 — Email + Turnstile + Google                                       */
/* -------------------------------------------------------------------------- */

function Step1Form({
  initialEmail,
  captchaToken,
  onCaptchaToken,
  onContinue,
  onError,
}: {
  initialEmail: string
  captchaToken: string | null
  onCaptchaToken: (token: string | null) => void
  onContinue: (email: string) => void
  onError: (msg: string | null) => void
}) {
  const form = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    mode: 'onSubmit',
    defaultValues: { email: initialEmail },
  })

  const isSubmitting = form.formState.isSubmitting
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  function onSubmit(values: EmailValues) {
    onError(null)
    onContinue(values.email)
  }

  return (
    <>
      <GoogleButton onError={(m) => onError(m)} />
      <Divider />
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
                    placeholder="Enter your email address"
                    disabled={isSubmitting}
                    className={inputClass}
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-red-400 text-xs" />
              </FormItem>
            )}
          />
          {siteKey ? (
            <div className="hidden">
              <Turnstile
                siteKey={siteKey}
                options={{ appearance: 'interaction-only', size: 'invisible' }}
                onSuccess={(token) => onCaptchaToken(token)}
                onError={() => {
                  onCaptchaToken(null)
                  onError(authErrorCodeToMessage('captcha_failed'))
                }}
                onExpire={() => onCaptchaToken(null)}
              />
            </div>
          ) : null}
          <Button
            type="submit"
            className="w-full h-10 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
            disabled={(!!siteKey && !captchaToken) || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Continuing&hellip;
              </>
            ) : (
              <>
                <span>Continue</span>
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </Form>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*  Step 2 — Password (+ confirm for signup)                                  */
/* -------------------------------------------------------------------------- */

interface Step2CommonProps {
  email: string
  captchaToken: string | null
  onBack: () => void
  onCaptchaInvalid: () => void
  onError: (msg: string | null) => void
}

function Step2SignInForm({
  email,
  captchaToken,
  onBack,
  onForgot,
  onCaptchaInvalid,
  onError,
}: Step2CommonProps & { onForgot: () => void }) {
  const form = useForm<SignInPasswordValues>({
    resolver: zodResolver(passwordSchema),
    mode: 'onSubmit',
    defaultValues: { password: '' },
  })
  const isSubmitting = form.formState.isSubmitting

  async function handleSubmit(values: SignInPasswordValues) {
    onError(null)
    try {
      const result = await signInWithEmail({
        email,
        password: values.password,
        captchaToken,
      })
      if (!result.ok) {
        if (result.errorCode === 'captcha_failed') {
          onError(authErrorCodeToMessage('captcha_failed'))
          onCaptchaInvalid()
          return
        }
        onError(result.errorMessage ?? authErrorCodeToMessage(result.errorCode))
        return
      }
    } catch {
      onError('Unable to connect. Check your internet connection and try again.')
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        noValidate
        className="space-y-4"
      >
        <div className="space-y-1">
          <p className="text-[0.8125rem] text-[#A1A1AA]">Signed in as</p>
          <p className="text-[0.875rem] text-[#FAFAFA] truncate">{email}</p>
        </div>

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">Password</FormLabel>
              <FormControl>
                <PasswordInput
                  disabled={isSubmitting}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  field={field}
                />
              </FormControl>
              <FormMessage className="text-red-400 text-xs" />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onForgot}
            className="text-[0.8125rem] text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
          >
            Forgot password?
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={isSubmitting}
            className="h-10 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/5"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <Button
            type="submit"
            className="flex-1 h-10 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in&hellip;
              </>
            ) : (
              <>
                <span>Sign in</span>
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  )
}

function Step2SignUpForm({
  email,
  captchaToken,
  onBack,
  onCaptchaInvalid,
  onEmailSent,
  onError,
}: Step2CommonProps & { onEmailSent: (email: string) => void }) {
  const form = useForm<SignUpPasswordValues>({
    resolver: zodResolver(signUpPasswordSchema),
    mode: 'onSubmit',
    defaultValues: { password: '', confirmPassword: '' },
  })
  const isSubmitting = form.formState.isSubmitting

  async function handleSubmit(values: SignUpPasswordValues) {
    onError(null)
    try {
      const origin =
        typeof window !== 'undefined'
          ? window.location.origin
          : process.env.NEXT_PUBLIC_SITE_URL ?? ''
      const result = await signUpWithEmail({
        email,
        password: values.password,
        captchaToken,
        emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
      })
      if (!result.ok) {
        if (result.errorCode === 'captcha_failed') {
          onError(authErrorCodeToMessage('captcha_failed'))
          onCaptchaInvalid()
          return
        }
        onError(result.errorMessage ?? authErrorCodeToMessage(result.errorCode))
        return
      }
      if (!result.hasSession) {
        onEmailSent(email)
      }
    } catch {
      onError('Unable to connect. Check your internet connection and try again.')
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        noValidate
        className="space-y-4"
      >
        <div className="space-y-1">
          <p className="text-[0.8125rem] text-[#A1A1AA]">Signed up as</p>
          <p className="text-[0.875rem] text-[#FAFAFA] truncate">{email}</p>
        </div>

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[0.8125rem] text-[#A1A1AA]">Password</FormLabel>
              <FormControl>
                <PasswordInput
                  disabled={isSubmitting}
                  autoComplete="new-password"
                  placeholder="Create a password"
                  field={field}
                />
              </FormControl>
              <FormMessage className="text-red-400 text-xs" />
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
                <PasswordInput
                  disabled={isSubmitting}
                  autoComplete="new-password"
                  placeholder="Confirm your password"
                  field={field}
                />
              </FormControl>
              <FormMessage className="text-red-400 text-xs" />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={isSubmitting}
            className="h-10 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/5"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <Button
            type="submit"
            className="flex-1 h-10 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account&hellip;
              </>
            ) : (
              <>
                <span>Sign up</span>
                <UserPlus className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  )
}

function Step2Form({
  mode,
  email,
  captchaToken,
  onBack,
  onForgot,
  onCaptchaInvalid,
  onEmailSent,
  onError,
}: {
  mode: AuthMode
  email: string
  captchaToken: string | null
  onBack: () => void
  onForgot: () => void
  onCaptchaInvalid: () => void
  onEmailSent: (email: string) => void
  onError: (msg: string | null) => void
}) {
  if (mode === 'signup') {
    return (
      <Step2SignUpForm
        email={email}
        captchaToken={captchaToken}
        onBack={onBack}
        onCaptchaInvalid={onCaptchaInvalid}
        onEmailSent={onEmailSent}
        onError={onError}
      />
    )
  }
  return (
    <Step2SignInForm
      email={email}
      captchaToken={captchaToken}
      onBack={onBack}
      onForgot={onForgot}
      onCaptchaInvalid={onCaptchaInvalid}
      onError={onError}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*  Reset password view                                                       */
/* -------------------------------------------------------------------------- */

function ResetForm({
  initialEmail,
  resetSent,
  onBack,
  onSent,
  onError,
}: {
  initialEmail: string
  resetSent: string | null
  onBack: () => void
  onSent: (email: string) => void
  onError: (msg: string | null) => void
}) {
  const form = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    mode: 'onSubmit',
    defaultValues: { email: initialEmail },
  })

  const isSubmitting = form.formState.isSubmitting

  async function onSubmit(values: EmailValues) {
    onError(null)
    try {
      const supabase = createClient()
      const origin =
        typeof window !== 'undefined'
          ? window.location.origin
          : process.env.NEXT_PUBLIC_SITE_URL ?? ''
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${origin}/auth/callback?next=/dashboard`,
      })
      if (error) {
        onError(mapSupabaseError(error.message))
        return
      }
      onSent(values.email)
    } catch {
      onError('Unable to connect. Check your internet connection and try again.')
    }
  }

  if (resetSent) {
    return (
      <div className="space-y-4">
        <Button
          type="button"
          onClick={onBack}
          variant="outline"
          className="w-full h-10 border-white/10 bg-white/4 text-[#FAFAFA] hover:bg-white/8 hover:border-white/20 text-sm"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to sign in
        </Button>
      </div>
    )
  }

  return (
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
                  placeholder="Enter your email address"
                  disabled={isSubmitting}
                  className={inputClass}
                  {...field}
                />
              </FormControl>
              <FormMessage className="text-red-400 text-xs" />
            </FormItem>
          )}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={isSubmitting}
            className="h-10 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/5"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <Button
            type="submit"
            className="flex-1 h-10 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending&hellip;
              </>
            ) : (
              <span>Send reset link</span>
            )}
          </Button>
        </div>
      </form>
    </Form>
  )
}

/* -------------------------------------------------------------------------- */
/*  Top-level dialog                                                          */
/* -------------------------------------------------------------------------- */

export function LoginDialog(props: LoginDialogProps) {
  const isControlled = props.open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? (props.open as boolean) : internalOpen
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    props.onOpenChange?.(next)
  }

  const [view, setView] = useState<AuthView>(props.initialView ?? 'step1')
  const [mode, setMode] = useState<AuthMode>(props.initialMode ?? 'signin')
  const [email, setEmail] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  // Sync internal state when controlled dialog opens with a requested initial view/mode.
  useEffect(() => {
    if (open) {
      if (props.initialView) setView(props.initialView)
      if (props.initialMode) setMode(props.initialMode)
    }
  }, [open, props.initialView, props.initialMode])

  function switchMode(m: AuthMode) {
    setMode(m)
    setView('step1')
    setEmail('')
    setCaptchaToken(null)
    setEmailSent(null)
    setResetSent(null)
    setAuthError(null)
  }

  function resetToStep1() {
    setView('step1')
    setResetSent(null)
    setEmailSent(null)
    setAuthError(null)
  }

  // Header copy logic
  let title: string
  let subtitle: string
  if (view === 'reset') {
    if (resetSent) {
      title = 'Check your email'
      subtitle = `We sent a reset link to ${resetSent}`
    } else {
      title = 'Reset your password'
      subtitle = "We'll email you a reset link"
    }
  } else if (mode === 'signup' && emailSent) {
    title = 'Check your email'
    subtitle = `We sent a confirmation link to ${emailSent}`
  } else if (view === 'step1') {
    title = mode === 'signin' ? 'Welcome back' : 'Create your account'
    subtitle = mode === 'signin' ? 'Sign in to your workspace' : 'Get started with Xphere'
  } else {
    // step2
    title = mode === 'signin' ? 'Welcome back' : 'Create your account'
    subtitle = `Continue as ${email}`
  }

  const showFooterModeToggle = view !== 'reset'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.children !== undefined && !isControlled ? (
        <DialogTrigger asChild>{props.children}</DialogTrigger>
      ) : null}
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[400px] p-0 gap-0 border-0 overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.7)] !bg-[#08090A]">
        <DialogTitle className="sr-only">
          {mode === 'signin' ? 'Sign in' : 'Sign up'} to Xphere
        </DialogTitle>
        <DialogDescription className="sr-only">
          {mode === 'signin' ? 'Sign in to your workspace' : 'Create a new account'}
        </DialogDescription>
        <div className="p-6">
          <div className="mb-6 text-center">
            <h1 className="text-[1.25rem] font-semibold tracking-[-0.02em] text-[#FAFAFA]">
              {title}
            </h1>
            <p className="text-[0.8125rem] text-[#71717A] mt-0.5">{subtitle}</p>
          </div>

          {authError && view !== 'reset' ? (
            <div className="mb-4">
              <AuthError message={authError} />
            </div>
          ) : null}

          {view === 'step1' && !emailSent ? (
            <Step1Form
              initialEmail={email}
              captchaToken={captchaToken}
              onCaptchaToken={setCaptchaToken}
              onContinue={(em) => {
                setEmail(em)
                setView('step2')
              }}
              onError={setAuthError}
            />
          ) : null}

          {view === 'step2' && !emailSent ? (
            <Step2Form
              mode={mode}
              email={email}
              captchaToken={captchaToken}
              onBack={() => setView('step1')}
              onForgot={() => setView('reset')}
              onCaptchaInvalid={() => {
                setCaptchaToken(null)
                setView('step1')
              }}
              onEmailSent={setEmailSent}
              onError={setAuthError}
            />
          ) : null}

          {view === 'reset' ? (
            <>
              {authError ? (
                <div className="mb-4">
                  <AuthError message={authError} />
                </div>
              ) : null}
              <ResetForm
                initialEmail={email}
                resetSent={resetSent}
                onBack={resetToStep1}
                onSent={setResetSent}
                onError={setAuthError}
              />
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-center gap-1 px-6 py-3.5 bg-white/[0.02] text-[0.8125rem] text-[#71717A] rounded-b-[inherit]">
          {!showFooterModeToggle ? (
            <button
              type="button"
              onClick={resetToStep1}
              className="font-medium text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
            >
              Back to sign in
            </button>
          ) : mode === 'signin' ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="font-medium text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
              >
                Sign up
              </button>
            </>
          ) : emailSent ? (
            <>
              Already confirmed?{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="font-medium text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="font-medium text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
