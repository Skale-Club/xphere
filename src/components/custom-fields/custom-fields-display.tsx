'use client'

import * as React from 'react'
import {
  getDefinitions,
  type CustomFieldDefinitionRow,
} from '@/app/(dashboard)/settings/custom-fields/actions'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'
import type { CustomFieldEntity, CustomFieldType } from '@/types/database'

interface CustomFieldsDisplayProps {
  entity: CustomFieldEntity
  customFields: Record<string, unknown> | null | undefined
}

export function CustomFieldsDisplay({ entity, customFields }: CustomFieldsDisplayProps) {
  const [definitions, setDefinitions] = React.useState<CustomFieldDefinitionRow[]>([])

  React.useEffect(() => {
    getDefinitions({ entity, includeArchived: false }).then((res) => {
      if (res.ok) setDefinitions(res.data)
    })
  }, [entity])

  if (definitions.length === 0) return null

  const fields = definitions
    .map((def) => {
      const raw = customFields?.[def.key]
      if (raw === undefined || raw === null || raw === '') return null
      const config = FIELD_RENDER_CONFIG[def.type as CustomFieldType]
      const display = config ? config.displayFormatter(raw) : String(raw)
      if (!display) return null
      return { def, display }
    })
    .filter(Boolean) as Array<{ def: CustomFieldDefinitionRow; display: string }>

  if (fields.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
        Custom Fields
      </div>
      {fields.map(({ def, display }) => (
        <div key={def.id} className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{def.label}</div>
            <div className="text-[13px] text-text-primary break-words">{display}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
