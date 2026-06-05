'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CurrencySelect } from '@/components/pipeline/currency-select'
import { updateDefaultCurrency } from '@/app/(dashboard)/settings/company-info/actions'

interface Props {
  defaultCurrency: string
}

export function CurrencySettingsSection({ defaultCurrency }: Props) {
  const [currency, setCurrency] = React.useState(defaultCurrency)
  const [saving, setSaving] = React.useState(false)
  const dirty = currency !== defaultCurrency

  async function handleSave() {
    setSaving(true)
    const res = await updateDefaultCurrency(currency)
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Failed to update currency')
      return
    }
    toast.success('Default currency updated')
  }

  return (
    <div className="rounded-[12px] border border-border-subtle p-6 space-y-4">
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-text-tertiary" />
        <h3 className="text-[14px] font-semibold text-text-primary">Default Currency</h3>
      </div>
      <p className="text-[13px] text-text-secondary">
        The default currency used for new opportunities in this workspace.
      </p>
      <div className="flex items-center gap-3">
        <CurrencySelect
          value={currency}
          onChange={setCurrency}
          className="w-[220px]"
        />
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
