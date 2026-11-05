/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  confirm: vi.fn(),
  prepare: vi.fn(),
  cancel: vi.fn(),
  google: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/auth/google-identity-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/google-identity-client')>()),
  sendGooglePhoneCode: mocks.send,
  confirmGooglePhoneCode: mocks.confirm,
  prepareGoogleIdentity: mocks.prepare,
  cancelGooglePhoneChallenge: mocks.cancel,
  signInGoogleAlternative: mocks.google,
}))

import { LoginDialog } from '@/components/auth/login-dialog'

const GOOGLE_CONFIG = {
  enabled: true, projectId: 'p', apiKey: 'k', authDomain: 'p.firebaseapp.com', googleClientId: 'c',
}

let root: Root
let container: HTMLDivElement

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const phoneField = () => document.querySelector<HTMLInputElement>('#login-phone')
const codeField = () => document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')
const sendButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    /Send code|Sending code/.test(b.textContent ?? ''),
  )
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function reachCodeStep() {
  await type(phoneField()!, '5085550100')
  await act(async () => { sendButton()!.click() })
  await settle()
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.prepare.mockResolvedValue({})
  mocks.send.mockResolvedValue(undefined)
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url === '/api/auth/config') return Response.json({ google: GOOGLE_CONFIG, countryIso: 'US' })
    // A signed-in user with no workspace keeps the test from navigating.
    return Response.json({ status: 'no_access' })
  })
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<LoginDialog open onOpenChange={() => {}} />))
  await settle()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('LoginDialog', () => {
  it('shows the Xphere logo and a neutral line, never "Welcome back"', () => {
    const text = dialog()!.textContent ?? ''
    expect(dialog()!.querySelector('[data-testid="login-logo"]')).not.toBeNull()
    expect(text).toContain('Sign in with your phone number.')
    expect(text).not.toContain('Welcome back')
    expect(text).not.toContain('create your account')
    expect(text).not.toContain('Access is by invitation')
    expect(dialog()!.querySelector('a[href="/terms"]')).not.toBeNull()
    expect(dialog()!.querySelector('a[href="/privacy"]')).not.toBeNull()
  })

  it('masks the number as it is typed', async () => {
    await type(phoneField()!, '5085550100')
    expect(phoneField()!.value).toBe('(508) 555-0100')
  })

  it('keeps Send code disabled until the number is complete', async () => {
    expect(sendButton()!.disabled).toBe(true)
    await type(phoneField()!, '508740')
    expect(sendButton()!.disabled).toBe(true)
    await type(phoneField()!, '5085550100')
    expect(sendButton()!.disabled).toBe(false)
  })

  it('sends the E.164 number and moves to the code step inside the same dialog', async () => {
    const before = dialog()!
    await reachCodeStep()

    expect(mocks.send).toHaveBeenCalledWith(GOOGLE_CONFIG, '+15085550100')
    expect(dialog()).toBe(before) // same element: nothing was closed or remounted
    expect(dialog()!.querySelector('[data-testid="login-logo"]')).not.toBeNull()
    expect(dialog()!.textContent).toContain('Enter the code')
    expect(dialog()!.textContent).toContain('(508) 555-0100')
    expect(dialog()!.textContent).toContain('Use another number')
    expect(dialog()!.textContent).toContain('New code in 30s')
    expect(dialog()!.querySelectorAll('[data-slot="code-box"]').length).toBe(6)
  })

  it('submits on the sixth digit without a click', async () => {
    mocks.confirm.mockResolvedValue('id-token')
    await reachCodeStep()
    await type(codeField()!, '123456')
    await settle()

    expect(mocks.confirm).toHaveBeenCalledWith('+15085550100', '123456')
    const call = mocks.fetch.mock.calls.find(([url]) => url === '/api/auth/identity')!
    expect(JSON.parse(call[1].body)).toEqual({ idToken: 'id-token' })
  })

  it('accepts a pasted code with spaces', async () => {
    mocks.confirm.mockResolvedValue('id-token')
    await reachCodeStep()
    await type(codeField()!, '123 456')
    await settle()
    expect(mocks.confirm).toHaveBeenCalledWith('+15085550100', '123456')
  })

  it('remembers the country of the last code sent, over the geo guess', async () => {
    const picker = () => document.querySelector('[data-testid="select-country-code"]')!.textContent
    expect(picker()).toContain('+1')
    window.localStorage.setItem('xphere_sign_in_country', '55')
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(<LoginDialog open onOpenChange={() => {}} />))
    await settle()
    expect(picker()).toContain('+55')
  })

  it('stores the country only once a code went out', async () => {
    expect(window.localStorage.getItem('xphere_sign_in_country')).toBeNull()
    await reachCodeStep()
    expect(window.localStorage.getItem('xphere_sign_in_country')).toBe('1')
  })

  it('clears a wrong code, keeps focus in the field and says what happened', async () => {
    mocks.confirm.mockRejectedValue(Object.assign(new Error('bad'), { code: 'auth/invalid-verification-code' }))
    await reachCodeStep()
    await type(codeField()!, '000000')
    await settle()

    expect(codeField()!.value).toBe('')
    expect(document.activeElement).toBe(codeField())
    const alert = dialog()!.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('not right or has expired')
    // The error sits above the field, not below it.
    expect(alert.compareDocumentPosition(codeField()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
