import { describe, expect, it } from 'vitest'
import { identityFromVerifiedClaims } from '@/lib/auth/google-identity'

const base = { sub: 'uid-123', firebase: { sign_in_provider: 'google.com' } }

describe('identityFromVerifiedClaims', () => {
  it('accepts a Google identity and keeps a verified email', () => {
    const identity = identityFromVerifiedClaims({ ...base, email: 'a@b.co', email_verified: true, name: 'Ana' })
    expect(identity).toMatchObject({ uid: 'uid-123', provider: 'google.com', email: 'a@b.co', name: 'Ana' })
    expect(identity.phone).toBeUndefined()
  })

  it('drops an email that is not verified', () => {
    expect(identityFromVerifiedClaims({ ...base, email: 'a@b.co', email_verified: false }).email).toBeUndefined()
    expect(identityFromVerifiedClaims({ ...base, email: 'a@b.co' }).email).toBeUndefined()
  })

  it('accepts a phone identity with an E.164 number', () => {
    const identity = identityFromVerifiedClaims({
      sub: 'p1',
      phone_number: '+15085550100',
      firebase: { sign_in_provider: 'phone' },
    })
    expect(identity).toMatchObject({ provider: 'phone', phone: '+15085550100' })
  })

  it('requires a valid phone for the phone provider', () => {
    expect(() =>
      identityFromVerifiedClaims({ sub: 'p1', firebase: { sign_in_provider: 'phone' } }),
    ).toThrow('Verified phone is required')
    expect(() =>
      identityFromVerifiedClaims({ sub: 'p1', phone_number: '5085550100', firebase: { sign_in_provider: 'phone' } }),
    ).toThrow('Verified phone is required')
  })

  it('rejects other providers, tenants, and bad subjects', () => {
    expect(() => identityFromVerifiedClaims({ sub: 'x', firebase: { sign_in_provider: 'password' } })).toThrow(
      'Unsupported Google identity',
    )
    expect(() => identityFromVerifiedClaims({ sub: 'x' })).toThrow('Unsupported Google identity')
    expect(() =>
      identityFromVerifiedClaims({ sub: 'x', firebase: { sign_in_provider: 'google.com', tenant: 't' } }),
    ).toThrow('Unsupported Google identity')
    expect(() => identityFromVerifiedClaims({ firebase: { sign_in_provider: 'google.com' } })).toThrow()
    expect(() =>
      identityFromVerifiedClaims({ sub: 'x'.repeat(129), firebase: { sign_in_provider: 'google.com' } }),
    ).toThrow('Unsupported Google identity')
  })
})
