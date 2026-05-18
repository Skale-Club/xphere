'use client'

import { useState } from 'react'
import { DefinitionsList } from './definitions-list'
import { DefinitionModal } from './definition-modal'
import type { CustomFieldDefinitionRow } from '@/app/(dashboard)/settings/custom-fields/actions'
import type { CustomFieldEntity } from '@/types/database'

interface CustomFieldsClientProps {
  definitions: CustomFieldDefinitionRow[]
  entity: CustomFieldEntity
}

export function CustomFieldsClient({ definitions, entity }: CustomFieldsClientProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingDef, setEditingDef] = useState<CustomFieldDefinitionRow | null>(null)

  return (
    <>
      <DefinitionsList
        definitions={definitions}
        entity={entity}
        onAddField={() => {
          setEditingDef(null)
          setIsModalOpen(true)
        }}
        onEditField={(def) => {
          setEditingDef(def)
          setIsModalOpen(true)
        }}
      />
      <DefinitionModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        entity={entity}
        definition={editingDef}
      />
    </>
  )
}
