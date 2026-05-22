'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export const CURRENCIES = [
  { code: 'BRL', label: 'BRL – Real Brasileiro' },
  { code: 'USD', label: 'USD – US Dollar' },
  { code: 'EUR', label: 'EUR – Euro' },
  { code: 'GBP', label: 'GBP – British Pound' },
  { code: 'MXN', label: 'MXN – Peso Mexicano' },
  { code: 'CLP', label: 'CLP – Peso Chileno' },
  { code: 'ARS', label: 'ARS – Peso Argentino' },
  { code: 'COP', label: 'COP – Peso Colombiano' },
  { code: 'PEN', label: 'PEN – Sol Peruano' },
  { code: 'JPY', label: 'JPY – Japanese Yen' },
  { code: 'CAD', label: 'CAD – Canadian Dollar' },
  { code: 'AUD', label: 'AUD – Australian Dollar' },
]

interface CurrencySelectProps {
  value: string
  onChange: (currency: string) => void
  className?: string
}

export function CurrencySelect({ value, onChange, className }: CurrencySelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-9 w-[90px] text-[12px] font-medium px-2.5', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c.code} value={c.code} className="text-[12px]">
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
