'use client'

import * as React from 'react'
import { HexColorPicker } from 'react-colorful'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

interface ColorPickerProps {
  value: string
  onChange: (hex: string) => void
  className?: string
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const safeValue = HEX_RE.test(value) ? value : '#6366F1'

  const [hexInput, setHexInput] = React.useState(safeValue.replace('#', ''))

  const prevValue = React.useRef(value)
  if (prevValue.current !== value) {
    prevValue.current = value
    setHexInput(safeValue.replace('#', ''))
  }

  function handleHexChange(raw: string) {
    const stripped = raw.replace(/^#+/, '').toUpperCase()
    setHexInput(stripped)
    const candidate = `#${stripped}`
    if (HEX_RE.test(candidate)) onChange(candidate)
  }

  function handleHexBlur() {
    const candidate = `#${hexInput}`
    if (!HEX_RE.test(candidate)) setHexInput(safeValue.replace('#', ''))
  }

  return (
    <>
      <style>{`
        .xp-colorpicker .react-colorful { width: 220px; }
        .xp-colorpicker .react-colorful__saturation { border-radius: 0; height: 156px; }
        .xp-colorpicker .react-colorful__hue { height: 12px; border-radius: 0; margin: 0; }
        .xp-colorpicker .react-colorful__saturation-pointer {
          width: 18px; height: 18px;
          border: 2px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.5);
        }
        .xp-colorpicker .react-colorful__hue-pointer {
          width: 16px; height: 16px;
          border: 2px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }
      `}</style>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Pick custom color"
            className={cn(
              'h-9 w-9 shrink-0 rounded-[8px] border border-border shadow-sm transition-all',
              'hover:scale-105 hover:shadow-md',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              className,
            )}
            style={{ backgroundColor: safeValue }}
          />
        </PopoverTrigger>

        <PopoverContent
          className="w-auto p-0 border border-border bg-bg-secondary shadow-2xl rounded-xl overflow-hidden"
          sideOffset={8}
          align="start"
        >
          <div className="xp-colorpicker flex flex-col">
            <HexColorPicker
              color={safeValue}
              onChange={(hex) => onChange(hex.toUpperCase())}
            />

            {/* Bottom bar: swatch + hex input */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 border-t border-border bg-bg-primary">
              <div
                className="h-6 w-6 shrink-0 rounded-md border border-border shadow-sm"
                style={{ backgroundColor: safeValue }}
              />
              <div className="flex items-center h-7 rounded-md border border-border bg-bg-secondary focus-within:ring-1 focus-within:ring-ring overflow-hidden">
                <span className="pl-2 pr-0.5 text-[11px] text-text-tertiary font-mono select-none">#</span>
                <input
                  type="text"
                  value={hexInput}
                  onChange={(e) => handleHexChange(e.target.value)}
                  onBlur={handleHexBlur}
                  maxLength={6}
                  spellCheck={false}
                  className="h-full w-[68px] bg-transparent pr-2 text-[11px] font-mono text-text-primary focus:outline-none"
                  placeholder="6366F1"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
