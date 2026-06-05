// Scopes a public API key (api_keys table) can hold. Shared by the settings UI,
// the key-generation server action, and the /api/v1/* route handlers so the
// allowed-scope list stays in one place.

export const API_KEY_SCOPES = [
  {
    key: 'contacts:write',
    label: 'Contacts — write',
    description: 'Create and update contacts via POST /api/v1/contacts',
  },
  {
    key: 'prospects:write',
    label: 'Prospects — write',
    description: 'Push prospect-stage records via POST /api/v1/prospects',
  },
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]['key']

export const API_KEY_SCOPE_KEYS: ApiKeyScope[] = API_KEY_SCOPES.map((s) => s.key)

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPE_KEYS as string[]).includes(value)
}

/** True when the key's scope array grants the required scope. */
export function hasScope(scopes: string[] | null | undefined, required: ApiKeyScope): boolean {
  return Array.isArray(scopes) && scopes.includes(required)
}
