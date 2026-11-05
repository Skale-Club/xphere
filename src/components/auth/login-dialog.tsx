'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, ArrowRight, ArrowLeft } from 'lucide-react'
import { defaultCountries, parseCountry, type CountryIso2 } from 'react-international-phone'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  cancelGooglePhoneChallenge,
  confirmGooglePhoneCode,
  googlePhoneError,
  prepareGoogleIdentity,
  sendGooglePhoneCode,
  signInGoogleAlternative,
  type GoogleLoginConfig,
} from '@/lib/auth/google-identity-client'
import {
  GOOGLE_NEEDS_PHONE_MESSAGE,
  NO_WORKSPACE_MESSAGE,
  signInErrorMessage,
} from '@/lib/auth/errors'

export interface LoginDialogProps {
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type Step = 'phone' | 'code' | 'no_workspace'

type IdentityResponse =
  | { status: 'active'; invite?: string }
  | { status: 'phone_required' }
  | { status: 'no_access' }
  | { status: 'no_org'; invite?: string }
  | { code?: string }

const RESEND_AFTER_MS = 30_000

// Loose on purpose: Identity Platform is the real validator and answers
// auth/invalid-phone-number. This only keeps an empty "+1" from costing a SMS
// round trip.
const E164 = /^\+[1-9]\d{7,14}$/

/** The server's guess at the visitor's country, if it names a country the phone field knows. */
function knownCountry(iso: string | null | undefined): CountryIso2 | null {
  const lower = iso?.toLowerCase()
  return defaultCountries.some((country) => parseCountry(country).iso2 === lower)
    ? (lower as CountryIso2)
    : null
}

const inputClass =
  'h-10 text-base md:text-sm bg-white/4 border-white/10 text-[#FAFAFA] placeholder:text-[#3F3F46] focus-visible:ring-indigo-500/40 focus-visible:border-indigo-500/50'

const primaryButtonClass =
  'w-full h-10 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium'

/**
 * Covers the whole dialog once a sign-in has succeeded and we are navigating.
 *
 * The dashboard layout renders server-side before the browser paints anything
 * new, so without this the dialog sat there looking idle and clickable for the
 * whole navigation: users read that as a failed login and signed in again,
 * opening a second session. The overlay is deliberately not dismissible.
 */
function NavigatingOverlay({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#08090A]/92 backdrop-blur-[2px]"
    >
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
      <p className="text-[0.875rem] text-[#FAFAFA]">{label}</p>
      <p className="text-[0.75rem] text-[#52525B]">Loading your workspace&hellip;</p>
    </div>
  )
}

function GoogleButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      className="w-full h-10 border-white/10 bg-white/4 text-[#FAFAFA] hover:bg-white/8 hover:border-white/20 text-sm"
      onClick={onClick}
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
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-white/8" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-[#08090A] px-2 text-[#3F3F46]">or</span>
      </div>
    </div>
  )
}

function Notice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="text-sm text-[#A1A1AA] p-3 rounded-lg bg-white/4 border border-white/10"
    >
      {message}
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

export function LoginDialog(props: LoginDialogProps) {
  const isControlled = props.open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? (props.open as boolean) : internalOpen

  const [config, setConfig] = useState<GoogleLoginConfig | null>(null)
  const [configFailed, setConfigFailed] = useState(false)
  const [countryIso, setCountryIso] = useState<CountryIso2 | null>(null)
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  // Once true this NEVER goes back to false: we are leaving this page. It is
  // what stops the "did my login work?" second click. There is no redirect in
  // the flow, so nothing else can re-enable the controls mid-navigation.
  const [navigating, setNavigating] = useState(false)
  const pending = useRef(false)
  const navigationLock = useRef(false)
  const codeRef = useRef<HTMLInputElement>(null)

  const setOpen = (next: boolean) => {
    if (navigationLock.current) return // don't let the user dismiss a sign-in in flight
    if (!isControlled) setInternalOpen(next)
    props.onOpenChange?.(next)
  }

  // The config names the Identity Platform project; fetched when the dialog
  // first opens so the landing page itself loads nothing for sign-in.
  useEffect(() => {
    if (!open || config) return
    let cancelled = false
    setConfigFailed(false)
    fetch('/api/auth/config', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('config')
        const body = (await response.json()) as { google?: GoogleLoginConfig; countryIso?: string | null }
        if (!body.google || body.google.enabled === false) throw new Error('config')
        return { google: body.google, countryIso: knownCountry(body.countryIso) }
      })
      .then(({ google, countryIso: guessed }) => {
        if (cancelled) return
        setConfig(google)
        setCountryIso(guessed)
        // Warm the SDK so the first tap on "Send code" does not wait for it.
        void prepareGoogleIdentity(google).catch(() => {})
      })
      .catch(() => {
        if (!cancelled) setConfigFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, config])

  // Back to a clean first step when the dialog closes (never mid-navigation).
  useEffect(() => {
    if (open || navigationLock.current) return
    cancelGooglePhoneChallenge()
    setStep('phone')
    setCode('')
    setError(null)
    setNote(null)
  }, [open])

  useEffect(() => cancelGooglePhoneChallenge, [])

  useEffect(() => {
    if (step !== 'code') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    const focus = window.setTimeout(() => codeRef.current?.focus(), 50)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(focus)
    }
  }, [step])

  const failure = useCallback((code: string | undefined) => {
    setError(signInErrorMessage(code))
  }, [])

  /** Hands the verified Firebase token to the server and acts on the outcome. */
  const completeSignIn = useCallback(
    async (idToken: string) => {
      const response = await fetch('/api/auth/identity', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = (await response.json().catch(() => ({}))) as IdentityResponse
      if (!response.ok || !('status' in data)) {
        failure((data as { code?: string }).code)
        return
      }
      if (data.status === 'active') {
        // The lock is taken before the navigation and never released: the
        // button must not come back to life while the page is leaving.
        navigationLock.current = true
        setNavigating(true)
        const invite = data.invite ? `?invite=${encodeURIComponent(data.invite)}` : ''
        window.location.assign(`/dashboard${invite}`)
        return
      }
      if (data.status === 'phone_required') {
        cancelGooglePhoneChallenge()
        setStep('phone')
        setCode('')
        setNote(GOOGLE_NEEDS_PHONE_MESSAGE)
        return
      }
      // no_access and no_org read the same to the person: nobody has put
      // them in a workspace yet.
      setStep('no_workspace')
    },
    [failure],
  )

  async function sendCode(target: string) {
    if (pending.current || navigationLock.current || !config) return
    if (!E164.test(target)) {
      failure('invalid_phone')
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await sendGooglePhoneCode(config, target)
      setCode('')
      setResendAt(Date.now() + RESEND_AFTER_MS)
      setNow(Date.now())
      setStep('code')
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') failure(googlePhoneError(err))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  async function verify(value: string) {
    if (pending.current || navigationLock.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await completeSignIn(await confirmGooglePhoneCode(phone, value))
    } catch (err) {
      setCode('')
      failure(googlePhoneError(err))
    } finally {
      pending.current = false
      // While navigating, busy stays true: nothing re-enables.
      if (!navigationLock.current) setBusy(false)
    }
  }

  async function continueWithGoogle() {
    if (pending.current || navigationLock.current || !config) return
    pending.current = true
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await completeSignIn(await signInGoogleAlternative(config))
    } catch (err) {
      failure(googlePhoneError(err))
    } finally {
      pending.current = false
      if (!navigationLock.current) setBusy(false)
    }
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6 && !pending.current) void verify(digits)
  }

  function backToStart() {
    cancelGooglePhoneChallenge()
    setStep('phone')
    setCode('')
    setError(null)
    setNote(null)
  }

  const locked = busy || navigating
  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

  let title = 'Welcome back'
  let subtitle = 'Sign in to your workspace'
  if (step === 'code') {
    title = 'Enter your code'
    subtitle = `We texted a 6-digit code to ${phone}`
  } else if (step === 'no_workspace') {
    title = 'No workspace yet'
    subtitle = 'You are signed out'
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.children !== undefined && !isControlled ? (
        <DialogTrigger asChild>{props.children}</DialogTrigger>
      ) : null}
      <DialogContent
        hideCloseButton={navigating}
        onEscapeKeyDown={(e) => {
          if (navigating) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (navigating) e.preventDefault()
        }}
        className="max-w-[calc(100%-2rem)] sm:max-w-[400px] p-0 gap-0 border-0 overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.7)] !bg-[#08090A]"
      >
        <DialogTitle className="sr-only">Sign in to Xphere</DialogTitle>
        <DialogDescription className="sr-only">Sign in to your workspace</DialogDescription>
        {navigating && <NavigatingOverlay label="Signing you in" />}
        <div className="p-6">
          <div className="mb-6 text-center">
            <h1 className="text-[1.25rem] font-semibold tracking-[-0.02em] text-[#FAFAFA]">
              {title}
            </h1>
            <p className="text-[0.8125rem] text-[#71717A] mt-0.5">{subtitle}</p>
          </div>

          {configFailed ? (
            <div className="mb-4">
              <AuthError message={signInErrorMessage('auth_unavailable')} />
            </div>
          ) : null}
          {error ? (
            <div className="mb-4">
              <AuthError message={error} />
            </div>
          ) : null}
          {note && step === 'phone' ? (
            <div className="mb-4">
              <Notice message={note} />
            </div>
          ) : null}

          {step === 'phone' ? (
            <>
              <form
                noValidate
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void sendCode(phone)
                }}
              >
                <div className="space-y-1.5">
                  <label htmlFor="login-phone" className="text-[0.8125rem] text-[#A1A1AA]">
                    Phone number
                  </label>
                  <PhoneInput
                    // Remounts once the config lands so the guessed country applies.
                    key={countryIso ?? 'default'}
                    defaultCountry={countryIso ?? 'us'}
                    id="login-phone"
                    value={phone}
                    onChange={setPhone}
                    disabled={locked}
                    aria-label="Phone number"
                  />
                </div>
                <Button
                  type="submit"
                  className={primaryButtonClass}
                  disabled={locked || !config}
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending code&hellip;
                    </>
                  ) : (
                    <>
                      <span>Send code</span>
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
              <Divider />
              <GoogleButton disabled={locked || !config} onClick={() => void continueWithGoogle()} />
            </>
          ) : null}

          {step === 'code' ? (
            <form
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (code.length === 6) void verify(code)
              }}
            >
              <Input
                ref={codeRef}
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                aria-label="6-digit code"
                disabled={locked}
                className={`${inputClass} text-center font-mono tracking-[0.5em]`}
              />
              <Button
                type="submit"
                className={primaryButtonClass}
                disabled={locked || code.length !== 6}
              >
                {locked ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying&hellip;
                  </>
                ) : (
                  <span>Verify</span>
                )}
              </Button>
              <div className="flex items-center justify-between text-[0.8125rem]">
                <button
                  type="button"
                  onClick={backToStart}
                  disabled={locked}
                  className="flex items-center gap-1 text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors disabled:opacity-50"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Change number
                </button>
                <button
                  type="button"
                  onClick={() => void sendCode(phone)}
                  disabled={locked || waitSeconds > 0}
                  className="text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors disabled:opacity-50"
                >
                  {waitSeconds > 0 ? `Resend in ${waitSeconds}s` : 'Resend code'}
                </button>
              </div>
            </form>
          ) : null}

          {step === 'no_workspace' ? (
            <div className="space-y-4">
              <Notice message={NO_WORKSPACE_MESSAGE} />
              <Button
                type="button"
                variant="outline"
                onClick={backToStart}
                className="w-full h-10 border-white/10 bg-white/4 text-[#FAFAFA] hover:bg-white/8 hover:border-white/20 text-sm"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to sign in
              </Button>
            </div>
          ) : null}
        </div>
        <div className="px-6 py-3.5 bg-white/[0.02] text-center text-[0.75rem] text-[#52525B] rounded-b-[inherit]">
          Access is by invitation. New here? Ask an administrator to invite you.
        </div>
      </DialogContent>
    </Dialog>
  )
}
