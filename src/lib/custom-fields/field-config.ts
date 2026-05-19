import type { CustomFieldType, CustomFieldEntity } from '@/types/database'

export const CUSTOM_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'select',
  'multi_select',
  'url',
  'email',
  'phone',
  'currency',
] as const satisfies readonly CustomFieldType[]

export const CUSTOM_FIELD_ENTITIES = [
  'contact',
  'opportunity',
  'account',
] as const satisfies readonly CustomFieldEntity[]
