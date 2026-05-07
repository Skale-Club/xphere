import { describe, it } from 'vitest'

describe('GCONTACTS-01: Admin can connect a Google account via OAuth', () => {
  it.todo('connectGoogleContacts sets CSRF state cookie with httpOnly and sameSite=lax')
  it.todo('connectGoogleContacts redirects to Google OAuth consent URL')
  it.todo('buildGoogleOAuthUrl includes access_type=offline in query params')
  it.todo('buildGoogleOAuthUrl includes contacts scope in query params')
  it.todo('buildGoogleOAuthUrl includes state param matching cookie value')
})

describe('GCONTACTS-01: OAuth callback stores encrypted tokens', () => {
  it.todo('callback returns 302 redirect to /integrations/google-contacts?connected=true on success')
  it.todo('callback rejects requests with mismatched CSRF state cookie')
  it.todo('callback resolves org_id via get_current_org_id() not request body')
  it.todo('callback upserts to integrations table with provider=google_contacts')
  it.todo('callback stores encrypted token blob in encrypted_api_key')
  it.todo('callback stores google_email in key_hint (unencrypted)')
  it.todo('callback stores token_expiry and google_email in config JSONB')
  it.todo('callback redirects to /integrations/google-contacts?error=csrf on state mismatch')
  it.todo('callback redirects to /integrations/google-contacts?error=oauth_exchange on token exchange failure')
})

describe('GCONTACTS-02: Admin can disconnect the Google account integration', () => {
  it.todo('disconnectGoogleContacts deletes integrations row with provider=google_contacts for current org')
  it.todo('disconnectGoogleContacts returns error when not authenticated')
  it.todo('disconnectGoogleContacts returns null error on success')
})
