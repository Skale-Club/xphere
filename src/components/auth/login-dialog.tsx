'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, ArrowRight, ArrowLeft, Phone, X } from 'lucide-react'

import { CodeSlots } from '@/components/auth/code-slots'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { XphereOrb } from '@/components/xphere-orb'
import { GradientTopLine } from '@/components/auth/gradient-top-line'
import { COUNTRY_PICKER_POPUP_ATTR, CountryCodePicker } from '@/components/auth/country-code-picker'
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
import {
  dialCodeOf,
  formatPhone,
  maskPhoneInput,
  normalizePhone,
  phoneCountryCodeFromIso,
  phoneCountryCodeFromLocales,
  rememberCountryCode,
  rememberedCountryCode,
  phonePlaceholderFor,
} from '@/lib/auth/phone'

export interface LoginDialogProps {
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type Step = 'phone' | 'code' | 'no_workspace'
type Action = 'send' | 'verify' | 'google'

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

const RECAPTCHA_IFRAME = 'iframe[src*="recaptcha"]'

/**
 * Whether a click or focus landed in Google's reCAPTCHA.
 *
 * The phone flow's invisible reCAPTCHA lives in a div appended to <body>, and
 * if Google decides to show an image challenge it does so in another body-level
 * div. Both sit outside the dialog, so Radix would count a tap on them as
 * "outside" and close the dialog under the person's finger.
 */
function isInsideRecaptcha(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(RECAPTCHA_IFRAME)) return true
  // The target may be the wrapper div itself rather than the iframe inside it.
  return Boolean(target.closest('body > div')?.querySelector(RECAPTCHA_IFRAME))
}

/** The country list is portalled to <body> too, so a tap on it is not "outside" either. */
function isInsideCountryPicker(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`[${COUNTRY_PICKER_POPUP_ATTR}]`))
}

function browserCountryCode(): string {
  if (typeof navigator === 'undefined') return phoneCountryCodeFromLocales([])
  return phoneCountryCodeFromLocales(navigator.languages ?? [navigator.language])
}

// 16px minimum on touch screens: below that iOS Safari zooms the page on focus.
const fieldClass =
  'h-12 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-base text-[#FAFAFA] placeholder:text-[#52525B] transition-colors ' +
  'focus-visible:outline-none focus-visible:border-indigo-500/60 focus-visible:ring-2 focus-visible:ring-indigo-500/40 ' +
  'aria-[invalid=true]:border-red-500/50 sm:text-sm'

const primaryButtonClass =
  'w-full h-12 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-50'

const linkButtonClass =
  'flex min-h-11 w-full items-center justify-center text-sm text-[#A1A1AA] transition-colors hover:text-[#FAFAFA] disabled:opacity-50 disabled:hover:text-[#A1A1AA]'

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
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#08090A]/92 backdrop-blur-[2px]"
    >
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
      <p className="text-[0.875rem] text-[#FAFAFA]">{label}</p>
      <p className="text-[0.75rem] text-[#A1A1AA]">Loading your workspace&hellip;</p>
    </div>
  )
}

function Brand() {
  return (
    <div
      data-testid="login-logo"
      role="img"
      aria-label="Xphere"
      className="flex items-center justify-center gap-2.5 text-xl font-semibold tracking-tight text-[#FAFAFA]"
    >
      <XphereOrb size={32} />
      <span aria-hidden="true">Xphere</span>
    </div>
  )
}

function GoogleButton({
  disabled,
  loading,
  onClick,
}: {
  disabled: boolean
  loading: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      aria-busy={loading}
      className="w-full h-12 border-white/10 bg-white/4 text-[#FAFAFA] hover:bg-white/8 hover:border-white/20 text-sm disabled:opacity-50"
      onClick={onClick}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Opening Google&hellip;
        </>
      ) : (
        <>
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continue with Google
        </>
      )}
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
        <span className="bg-[#08090A] px-2 text-[#A1A1AA]">or</span>
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

function AuthError({ message, id }: { message: string; id?: string }) {
  return (
    <div
      id={id}
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
  // The server's guess (from the request's geo headers) at the visitor's country.
  const [countryGuess, setCountryGuess] = useState<string | null>(null)
  const [countryCode, setCountryCode] = useState<string>(() => rememberedCountryCode() ?? browserCountryCode())
  const [step, setStep] = useState<Step>('phone')
  // What the person typed, masked ("(508) 555-0100"), and the E.164 we sent the code to.
  const [phoneInput, setPhoneInput] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
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
  // A country the person picked is never overwritten by a guess.
  const countryChosen = useRef(rememberedCountryCode() !== null)

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
        return { google: body.google, guess: phoneCountryCodeFromIso(body.countryIso) }
      })
      .then(({ google, guess }) => {
        if (cancelled) return
        setConfig(google)
        setCountryGuess(guess)
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

  // The geo guess beats the browser-language guess, but only while the person has
  // not picked a country (now or on an earlier sign-in) and has not started typing.
  useEffect(() => {
    if (!open || !countryGuess || countryChosen.current || phoneInput) return
    setCountryCode(countryGuess)
  }, [open, countryGuess, phoneInput])

  // Back to a clean first step when the dialog closes (never mid-navigation).
  useEffect(() => {
    if (open || navigationLock.current) return
    cancelGooglePhoneChallenge()
    setStep('phone')
    setPhoneInput('')
    setPhone('')
    setCode('')
    setError(null)
    setNote(null)
    const remembered = rememberedCountryCode()
    countryChosen.current = remembered !== null
    setCountryCode(remembered ?? browserCountryCode())
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
    setAction('send')
    setError(null)
    setNote(null)
    try {
      await sendGooglePhoneCode(config, target)
      // Only after a code really went out, so a mistaken pick is not remembered.
      rememberCountryCode(dialCodeOf(target) ?? countryCode)
      setPhone(target)
      setCode('')
      setResendAt(Date.now() + RESEND_AFTER_MS)
      setNow(Date.now())
      setStep('code')
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') failure(googlePhoneError(err))
    } finally {
      pending.current = false
      setBusy(false)
      setAction(null)
    }
  }

  async function verify(value: string) {
    if (pending.current || navigationLock.current) return
    pending.current = true
    setBusy(true)
    setAction('verify')
    setError(null)
    try {
      await completeSignIn(await confirmGooglePhoneCode(phone, value))
    } catch (err) {
      setCode('')
      failure(googlePhoneError(err))
    } finally {
      pending.current = false
      // While navigating, busy stays true: nothing re-enables.
      if (!navigationLock.current) {
        setBusy(false)
        setAction(null)
      }
    }
  }

  async function continueWithGoogle() {
    if (pending.current || navigationLock.current || !config) return
    pending.current = true
    setBusy(true)
    setAction('google')
    setError(null)
    setNote(null)
    try {
      await completeSignIn(await signInGoogleAlternative(config))
    } catch (err) {
      failure(googlePhoneError(err))
    } finally {
      pending.current = false
      if (!navigationLock.current) {
        setBusy(false)
        setAction(null)
      }
    }
  }

  function onCodeChange(value: string) {
    // No maxLength on the input: it would cut a pasted "123 456" at 6 characters.
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits) setError(null)
    if (digits.length === 6 && !pending.current) void verify(digits)
  }

  function onPhoneChange(value: string) {
    if (error) setError(null)
    // A pasted "+55 11 ..." switches the picker instead of being read as a US number.
    const pasted = value.trim().startsWith('+') ? dialCodeOf(value) : null
    if (pasted && pasted !== countryCode) {
      countryChosen.current = true
      setCountryCode(pasted)
      setPhoneInput(maskPhoneInput(value, pasted))
      return
    }
    setPhoneInput(maskPhoneInput(value, countryCode))
  }

  function onCountryChange(next: string) {
    countryChosen.current = true
    setCountryCode(next)
    setPhoneInput((current) => maskPhoneInput(current, next))
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
  // Long enough for the chosen country, in the E.164 form that goes to Identity Platform.
  const target = normalizePhone(phoneInput, countryCode)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.children !== undefined && !isControlled ? (
        <DialogTrigger asChild>{props.children}</DialogTrigger>
      ) : null}
      <DialogContent
        // The default close button is 24px; ours below is a 44px target.
        hideCloseButton
        onEscapeKeyDown={(e) => {
          if (navigating) e.preventDefault()
        }}
        // Covers both a tap outside and focus leaving the dialog.
        onInteractOutside={(e) => {
          const eventTarget = e.detail.originalEvent.target
          if (navigating || isInsideRecaptcha(eventTarget) || isInsideCountryPicker(eventTarget)) {
            e.preventDefault()
          }
        }}
        className="max-w-[calc(100%-2rem)] sm:max-w-[400px] p-0 gap-0 border border-white/10 rounded-2xl overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.7)] !bg-[#08090A]"
      >
        <DialogTitle className="sr-only">Sign in to Xphere</DialogTitle>
        <GradientTopLine />
        {navigating && <NavigatingOverlay label="Signing you in" />}
        <div className="relative px-6 pb-6 pt-9 sm:px-8">
          <Brand />

          {/* Only the step content is keyed: the dialog itself is never remounted between steps. */}
          <div
            key={step}
            className="mt-5 min-h-[21.25rem] animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
          >
            {step === 'phone' ? (
              <>
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (target) void sendCode(target)
                    else failure('invalid_phone')
                  }}
                >
                  <DialogDescription className="text-center text-sm text-[#A1A1AA]">
                    Sign in with your phone number.
                  </DialogDescription>

                  <div className="mt-6 space-y-4">
                    <div className="space-y-3 empty:hidden">
                      {configFailed ? <AuthError message={signInErrorMessage('auth_unavailable')} /> : null}
                      {note ? <Notice message={note} /> : null}
                      {error ? <AuthError id="login-error" message={error} /> : null}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="login-phone" className="block text-sm font-medium text-[#D4D4D8]">
                        Phone number
                      </label>
                      <div className="flex gap-2">
                        <CountryCodePicker
                          value={countryCode}
                          onChange={onCountryChange}
                          label="Country"
                          disabled={locked}
                        />
                        <div className="relative min-w-0 flex-1">
                          {/* No icon on a phone: its width would cut off the last digits. */}
                          <Phone className="pointer-events-none absolute left-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-white/40 sm:block" />
                          <input
                            id="login-phone"
                            value={phoneInput}
                            onChange={(e) => onPhoneChange(e.target.value)}
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel-national"
                            enterKeyHint="go"
                            placeholder={phonePlaceholderFor(countryCode)}
                            autoFocus
                            // readOnly, not disabled: a disabled field drops focus and the phone keyboard with it.
                            readOnly={locked}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? 'login-error' : undefined}
                            className={`${fieldClass} sm:pl-10`}
                          />
                        </div>
                      </div>
                    </div>

                    <Button type="submit" className={primaryButtonClass} disabled={locked || !config || !target}>
                      {action === 'send' ? (
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
                  </div>
                </form>
                <Divider />
                <GoogleButton
                  disabled={locked || !config}
                  loading={action === 'google'}
                  onClick={() => void continueWithGoogle()}
                />
                <p className="mt-5 text-center text-xs leading-relaxed text-[#A1A1AA]">
                  By continuing you agree to the{' '}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#D4D4D8] underline-offset-2 hover:underline"
                  >
                    Terms of Service
                  </a>{' '}
                  and the{' '}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#D4D4D8] underline-offset-2 hover:underline"
                  >
                    Privacy Policy
                  </a>
                  .
                </p>
              </>
            ) : null}

            {step === 'code' ? (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault()
                  if (code.length === 6) void verify(code)
                }}
              >
                <button
                  type="button"
                  onClick={backToStart}
                  disabled={locked}
                  className="-ml-2 flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-[#A1A1AA] transition-colors hover:text-[#FAFAFA] disabled:opacity-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Use another number
                </button>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#FAFAFA]">Enter the code</h2>
                <DialogDescription className="mt-1 text-sm text-[#A1A1AA]">
                  We texted a 6-digit code to {formatPhone(phone)}.
                </DialogDescription>

                <div className="mt-5 space-y-4">
                  {error ? <AuthError id="login-error" message={error} /> : null}
                  <CodeSlots
                    ref={codeRef}
                    value={code}
                    onChange={onCodeChange}
                    enterKeyHint="go"
                    aria-label="6-digit code"
                    autoFocus
                    readOnly={locked}
                    invalid={Boolean(error)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <Button type="submit" className={primaryButtonClass} disabled={locked || code.length !== 6}>
                    {locked ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying&hellip;
                      </>
                    ) : (
                      <span>Continue</span>
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => void sendCode(phone)}
                    disabled={locked || waitSeconds > 0}
                    className={linkButtonClass}
                  >
                    {action === 'send'
                      ? 'Sending…'
                      : waitSeconds > 0
                        ? `New code in ${waitSeconds}s`
                        : 'Send a new code'}
                  </button>
                </div>
              </form>
            ) : null}

            {step === 'no_workspace' ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-[#FAFAFA]">No workspace yet</h2>
                  <DialogDescription className="mt-1 text-sm text-[#A1A1AA]">
                    You are signed out.
                  </DialogDescription>
                </div>
                <Notice message={NO_WORKSPACE_MESSAGE} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={backToStart}
                  className="w-full h-12 border-white/10 bg-white/4 text-[#FAFAFA] hover:bg-white/8 hover:border-white/20 text-sm"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to sign in
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        {!navigating && (
          <DialogClose className="absolute right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-lg text-[#A1A1AA] transition-colors hover:bg-white/5 hover:text-[#FAFAFA] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        )}
      </DialogContent>
    </Dialog>
  )
}
