'use client'

import { forwardRef } from 'react'

/**
 * Off-screen bait input for public forms. People never see or reach it (no
 * tab stop, hidden from assistive tech, autofill opted out); naive bots fill
 * every input they find. The server treats any value as a bot and answers with
 * a fake success — see isBotSubmission in src/lib/security/bot-defense.ts.
 *
 * Positioned off-screen rather than display:none, which smarter bots skip.
 * Uncontrolled on purpose: read it with the forwarded ref at submit time.
 */
export const HoneypotField = forwardRef<HTMLInputElement, { name?: string }>(
  function HoneypotField({ name = 'hp_extra' }, ref) {
    return (
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}
      >
        <label>
          Leave this field empty
          <input ref={ref} type="text" name={name} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
    )
  },
)
