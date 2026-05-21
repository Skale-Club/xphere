// src/lib/custom-fields/reserved-keys.ts
// Phase 69 CUSTOMFIELDS-CORE-LIB | Plan 69-01
//
// Single TypeScript source of truth for reserved key sets, matching the
// custom_field_definitions_key_not_reserved CHECK constraint in
// supabase/migrations/065_custom_field_definitions.sql verbatim.
// DO NOT change these sets without a companion migration.

import type { CustomFieldEntity } from '@/types/database'

/** Keys reserved across ALL entities | universal set (matches Postgres CHECK). */
const UNIVERSAL_RESERVED: readonly string[] = [
  'id',
  'org_id',
  'created_at',
  'updated_at',
  'created_by',
]

/**
 * Per-entity native columns that cannot be used as custom field keys.
 * Values must stay byte-identical to the CASE branches in
 * custom_field_definitions_key_not_reserved.
 */
const PER_ENTITY_RESERVED: Record<CustomFieldEntity, readonly string[]> = {
  contact: [
    'name',
    'phone',
    'email',
    'company',
    'notes',
    'tags',
    'custom_fields',
    'source',
    'external_id',
    'account_id',
  ],
  opportunity: [
    'contact_id',
    'pipeline_id',
    'stage_id',
    'title',
    'value',
    'currency',
    'status',
    'expected_close_date',
    'assigned_to',
    'position',
    'custom_fields',
    'account_id',
  ],
  account: [
    'name',
    'domain',
    'website',
    'industry',
    'size',
    'phone',
    'address',
    'notes',
    'tags',
    'custom_fields',
    'source',
    'external_id',
    'assigned_to',
  ],
}

/**
 * Combined reserved key sets per entity.
 * Each value is the union of UNIVERSAL_RESERVED and the entity's own native
 * columns, deduplicated. Use this as the authoritative lookup for CF-11.
 */
export const RESERVED_KEYS_BY_ENTITY: Record<CustomFieldEntity, readonly string[]> = {
  contact: Array.from(new Set([...UNIVERSAL_RESERVED, ...PER_ENTITY_RESERVED.contact])),
  opportunity: Array.from(new Set([...UNIVERSAL_RESERVED, ...PER_ENTITY_RESERVED.opportunity])),
  account: Array.from(new Set([...UNIVERSAL_RESERVED, ...PER_ENTITY_RESERVED.account])),
}

/**
 * Returns true when `key` is in the reserved set for `entity`.
 * Use this guard in validate.ts and any future key-submission handler.
 */
export function isReservedKey(entity: CustomFieldEntity, key: string): boolean {
  return RESERVED_KEYS_BY_ENTITY[entity].includes(key)
}
