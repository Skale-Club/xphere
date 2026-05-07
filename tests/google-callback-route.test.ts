import { describe, it } from 'vitest'

describe('GCONTACTS-01: GET /api/google/callback — happy path', () => {
  it.todo('exchanges auth code for access_token and refresh_token')
  it.todo('fetches google account email via userinfo endpoint')
  it.todo('encrypts token bundle with AES-256-GCM before storing')
  it.todo('upserts integrations row with onConflict organization_id,provider')
  it.todo('stores config JSONB with token_expiry and google_email')
  it.todo('redirects to /integrations/google-contacts?connected=true')
})

describe('GCONTACTS-01: GET /api/google/callback — error paths', () => {
  it.todo('redirects to /login when user is not authenticated')
  it.todo('redirects with error=missing_code when code param absent')
  it.todo('redirects with error=csrf when state cookie does not match')
  it.todo('redirects with error=no_org when get_current_org_id() returns null')
  it.todo('redirects with error=oauth_exchange when token exchange throws')
  it.todo('handles absent refresh_token on reconnect without crashing')
})

describe('GET /api/google/oauth — OAuth initiation route', () => {
  it.todo('sets httpOnly CSRF state cookie with 10-minute TTL')
  it.todo('redirects to Google OAuth consent URL')
  it.todo('returns 302 redirect to /login when user is unauthenticated')
})
