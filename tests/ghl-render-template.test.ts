// tests/ghl-render-template.test.ts
// Phase 32 — REENG-08 coverage scaffold.
// RED until Plan 02 ships src/lib/automations/ghl-reengagement/render-template.ts.

import { describe, it, expect } from 'vitest'

// Will be imported once Plan 02 ships:
// import { renderMessage } from '@/lib/automations/ghl-reengagement/render-template'

describe('renderMessage (REENG-08)', () => {
  it('replaces {{first_name}} with the provided firstName', () => {
    // expect(renderMessage('Olá {{first_name}}, sentimos sua falta!', 'Maria'))
    //   .toBe('Olá Maria, sentimos sua falta!')
    expect.fail('Plan 02 must implement renderMessage — test stub from Plan 01 Wave 0')
  })

  it('replaces multiple occurrences of {{first_name}}', () => {
    // expect(renderMessage('{{first_name}}, {{first_name}} aqui é da Skleanings.', 'João'))
    //   .toBe('João, João aqui é da Skleanings.')
    expect.fail('Plan 02 must support multiple substitutions — test stub from Plan 01 Wave 0')
  })

  it('tolerates whitespace inside the placeholder: {{ first_name }}', () => {
    // expect(renderMessage('Oi {{ first_name }}', 'Ana')).toBe('Oi Ana')
    expect.fail('Plan 02 must allow whitespace in placeholder — test stub from Plan 01 Wave 0')
  })

  it('substitutes "amigo(a)" when firstName is null', () => {
    // expect(renderMessage('Oi {{first_name}}', null)).toBe('Oi amigo(a)')
    expect.fail('Plan 02 must fallback to amigo(a) on null — test stub from Plan 01 Wave 0')
  })

  it('substitutes "amigo(a)" when firstName is undefined', () => {
    // expect(renderMessage('Oi {{first_name}}', undefined)).toBe('Oi amigo(a)')
    expect.fail('Plan 02 must fallback to amigo(a) on undefined — test stub from Plan 01 Wave 0')
  })

  it('substitutes "amigo(a)" when firstName is empty string', () => {
    // expect(renderMessage('Oi {{first_name}}', '')).toBe('Oi amigo(a)')
    expect.fail('Plan 02 must fallback to amigo(a) on empty string — test stub from Plan 01 Wave 0')
  })

  it('substitutes "amigo(a)" when firstName is whitespace-only', () => {
    // expect(renderMessage('Oi {{first_name}}', '   ')).toBe('Oi amigo(a)')
    expect.fail('Plan 02 must fallback to amigo(a) on whitespace — test stub from Plan 01 Wave 0')
  })

  it('leaves text without placeholder unchanged', () => {
    // expect(renderMessage('Mensagem fixa.', 'Maria')).toBe('Mensagem fixa.')
    expect.fail('Plan 02 must not touch non-placeholder text — test stub from Plan 01 Wave 0')
  })
})
