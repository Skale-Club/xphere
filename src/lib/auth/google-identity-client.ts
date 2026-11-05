import type { Auth, ConfirmationResult, RecaptchaVerifier } from 'firebase/auth'

// Browser half of the Identity Platform sign-in. firebase is imported
// dynamically everywhere so it stays out of every page's bundle: only the
// sign-in dialog pays for it, and only once it is open.

export interface GoogleLoginConfig {
  enabled: boolean
  projectId: string
  apiKey: string
  authDomain: string
  googleClientId: string
}

let auth: Auth | undefined
let initializing: Promise<Auth> | undefined
let confirmation: { phone: string; result: ConfirmationResult } | undefined
let captcha: RecaptchaVerifier | undefined
let node: HTMLDivElement | undefined
let generation = 0

export function prepareGoogleIdentity(config: GoogleLoginConfig): Promise<Auth> {
  initializing ??= (async () => {
    const [appSdk, sdk] = await Promise.all([import('firebase/app'), import('firebase/auth')])
    const app =
      appSdk.getApps().find((existing) => existing.name === 'xphere-auth') ??
      appSdk.initializeApp(config, 'xphere-auth')
    auth = sdk.getAuth(app)
    // The application cookie owns the session. Do not retain a second
    // persistent login in the browser after the app signs out or is reloaded.
    await sdk.setPersistence(auth, sdk.inMemoryPersistence)
    auth.useDeviceLanguage()
    return auth
  })().catch((error) => {
    initializing = undefined
    throw error
  })
  return initializing
}

export function cancelGooglePhoneChallenge() {
  ++generation
  confirmation = undefined
  captcha?.clear()
  captcha = undefined
  node?.remove()
  node = undefined
}

export async function sendGooglePhoneCode(config: GoogleLoginConfig, phone: string) {
  cancelGooglePhoneChallenge()
  const current = generation
  const [instance, sdk] = await Promise.all([prepareGoogleIdentity(config), import('firebase/auth')])
  if (current !== generation) throw new DOMException('Cancelled', 'AbortError')
  node = document.createElement('div')
  document.body.appendChild(node)
  const challenge = new sdk.RecaptchaVerifier(instance, node, { size: 'invisible' })
  captcha = challenge
  try {
    const result = await sdk.signInWithPhoneNumber(instance, phone, challenge)
    if (current !== generation) throw new DOMException('Cancelled', 'AbortError')
    confirmation = { phone, result }
  } finally {
    if (captcha === challenge) {
      captcha.clear()
      captcha = undefined
      node?.remove()
      node = undefined
    }
  }
}

export async function confirmGooglePhoneCode(phone: string, code: string) {
  if (confirmation?.phone !== phone) {
    throw Object.assign(new Error('Request another code'), { code: 'auth/code-expired' })
  }
  return (await confirmation.result.confirm(code)).user.getIdToken(true)
}

export async function signInGoogleAlternative(config: GoogleLoginConfig) {
  const [instance, sdk] = await Promise.all([prepareGoogleIdentity(config), import('firebase/auth')])
  return (await sdk.signInWithPopup(instance, new sdk.GoogleAuthProvider())).user.getIdToken()
}

export async function signOutGoogleIdentity() {
  cancelGooglePhoneChallenge()
  if (auth) await (await import('firebase/auth')).signOut(auth)
}

export function googlePhoneError(error: unknown): string {
  const code = (error as { code?: string })?.code
  if (code === 'auth/invalid-phone-number') return 'invalid_phone'
  if (code === 'auth/too-many-requests') return 'rate_limited'
  if (code === 'auth/quota-exceeded') return 'too_many_codes'
  if (['auth/invalid-verification-code', 'auth/code-expired', 'auth/session-expired'].includes(code ?? '')) {
    return 'wrong_code'
  }
  if (
    ['auth/network-request-failed', 'auth/captcha-check-failed', 'auth/invalid-app-credential'].includes(code ?? '')
  ) {
    return 'sms_failed'
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'popup_closed'
  return 'generic'
}
