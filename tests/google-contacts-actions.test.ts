import { describe, it } from 'vitest'

describe('ACTIONS-01: createGoogleContact', () => {
  it.todo('calls POST people.googleapis.com/v1/people:createContact with correct body')
  it.todo('splits name param into givenName and familyName at first whitespace')
  it.todo('returns single-line string containing resourceName (no newlines)')
  it.todo('throws People API error string on non-2xx response')
  it.todo('omits undefined fields from the request body (only includes provided params)')
})

describe('ACTIONS-02: updateGoogleContact', () => {
  it.todo('calls searchContacts first to obtain resourceName and etag')
  it.todo('calls PATCH updateContact with etag from searchContacts result')
  it.todo('builds updatePersonFields mask from only the provided params keys')
  it.todo("throws 'Contact not found for update: {email}' when searchContacts returns empty results")
})

describe('ACTIONS-03: findGoogleContact', () => {
  it.todo("returns 'Found: displayName | email | phone' when contact found (single result)")
  it.todo("returns 'No contact found matching that query.' when results array is empty")
  it.todo("includes '(1 of N matches)' suffix when results.length > 1")
  it.todo('omits absent fields from the Found: summary string')
  it.todo('uses email param as query when provided; falls back to phone param')
})

describe('ACTIONS-04: deleteGoogleContact', () => {
  it.todo('calls searchContacts to get resourceName then calls DELETE deleteContact')
  it.todo("throws 'Contact not found for delete: {email}' when searchContacts returns empty results")
  it.todo('returns single-line success string on DELETE 200 response (no newlines)')
})

describe('resolveGoogleCredentials: no-integration guard', () => {
  it.todo("throws 'Google Contacts not connected for this org. Connect via /integrations.' when integrations row is missing")
  it.todo('returns access_token, refresh_token, google_email, integrationId from decrypted blob')
})

describe('callWithRefresh: token refresh on 401', () => {
  it.todo('retries the API call with new access_token when first call returns 401')
  it.todo('persists new encrypted token blob to integrations row after successful refresh')
  it.todo('preserves original refresh_token in the new encrypted blob (Google does not return a new one)')
  it.todo('throws when token refresh itself fails (non-2xx from oauth2.googleapis.com/token)')
})
