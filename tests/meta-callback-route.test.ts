import { describe, it } from 'vitest'

describe('META-01: successful callback', () => {
  it.todo('rejects unauthenticated requests and redirects to /login')
  it.todo('rejects a CSRF state mismatch and redirects to /integrations/meta?error=csrf')
  it.todo('exchanges the authorization code before any database write occurs')
  it.todo('upserts one messenger row per page and one instagram row when instagram_business_account exists')
})

describe('META-02: token exchange chain', () => {
  it.todo('exchanges short-lived user token for long-lived user token')
  it.todo('fetches page access tokens from /me/accounts')
  it.todo('encrypts the page access token before writing meta_channels')
  it.todo('never stores the short-lived or long-lived user token in the database')
})

describe('META-05: callback failure handling', () => {
  it.todo('redirects to /integrations/meta?error=missing_code when code is absent')
  it.todo('redirects to /integrations/meta?error=oauth_exchange when Meta returns an error')
})
