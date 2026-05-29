// src/lib/ghl/list-custom-fields.ts
// Fetches the location's custom-field definitions so a contact's
// customFields[].id can be translated into a readable key for Xphere's
// custom_fields jsonb.
//
// Confirmed shape: GET /locations/{id}/customFields returns
// { customFields: [{ id, name, fieldKey, dataType, model, ... }] }.
// fieldKey looks like "contact.business_name"; we strip the model prefix.

import { ghlFetchJson, type GhlCredentials } from './client'

interface GhlCustomFieldDef {
  id: string
  name?: string
  fieldKey?: string
}

interface CustomFieldsResponse {
  customFields: GhlCustomFieldDef[]
}

/** Strips a leading model prefix ("contact.", "opportunity.") from a fieldKey. */
function normaliseFieldKey(fieldKey: string | undefined, fallback: string): string {
  if (!fieldKey) return fallback
  const dot = fieldKey.indexOf('.')
  const stripped = dot >= 0 ? fieldKey.slice(dot + 1) : fieldKey
  return stripped.trim() || fallback
}

/**
 * Returns a map of `customField id → readable key` for the location. Falls back
 * to the raw id when a definition has no usable fieldKey. Returns an empty map
 * if the location exposes no custom fields.
 */
export async function getGhlCustomFieldKeyMap(
  credentials: GhlCredentials,
  timeoutMs = 10_000,
): Promise<Record<string, string>> {
  const data = await ghlFetchJson<CustomFieldsResponse>(
    `/locations/${credentials.locationId}/customFields`,
    'GET',
    null,
    credentials,
    undefined,
    timeoutMs,
  )

  const map: Record<string, string> = {}
  for (const def of data.customFields ?? []) {
    if (!def.id) continue
    map[def.id] = normaliseFieldKey(def.fieldKey, def.id)
  }
  return map
}
