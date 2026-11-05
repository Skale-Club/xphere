import { describe, expect, it } from 'vitest'
import { maskPhoneInput, normalizePhone, phonePlaceholderFor } from '@/lib/auth/phone'

describe('maskPhoneInput', () => {
  it('formats a US number as you type, without trailing separators', () => {
    expect(maskPhoneInput('', '1')).toBe('')
    expect(maskPhoneInput('5', '1')).toBe('(5')
    expect(maskPhoneInput('508', '1')).toBe('(508')
    expect(maskPhoneInput('5087', '1')).toBe('(508) 7')
    expect(maskPhoneInput('508740', '1')).toBe('(508) 740')
    expect(maskPhoneInput('5085550100', '1')).toBe('(508) 555-0100')
  })

  it('is stable when its own output is fed back in (every keystroke re-masks)', () => {
    for (const cc of ['1', '55', '52', '57', '351', '34']) {
      const once = maskPhoneInput('123456789012', cc)
      expect(maskPhoneInput(once, cc)).toBe(once)
    }
  })

  it('lets Backspace through the separators', () => {
    expect(maskPhoneInput('(508) 7', '1')).toBe('(508) 7')
    expect(maskPhoneInput('(508) ', '1')).toBe('(508')
    expect(maskPhoneInput('(5', '1')).toBe('(5')
    expect(maskPhoneInput('(', '1')).toBe('')
  })

  it('caps the digits at what the country allows', () => {
    expect(maskPhoneInput('508555010099', '1')).toBe('(508) 555-0100')
    expect(maskPhoneInput('119123456789999', '55')).toBe('(11) 91234-5678')
  })

  it('formats Brazil, Mexico, Colombia, Portugal and Spain like their placeholders', () => {
    expect(maskPhoneInput('11912345678', '55')).toBe('(11) 91234-5678')
    expect(maskPhoneInput('5512345678', '52')).toBe('55 1234 5678')
    expect(maskPhoneInput('3101234567', '57')).toBe('310 123 4567')
    expect(maskPhoneInput('912345678', '351')).toBe('912 345 678')
    expect(maskPhoneInput('612345678', '34')).toBe('612 34 56 78')
  })

  it('drops the dial code from a pasted international number', () => {
    expect(maskPhoneInput('+1 508 555 0100', '1')).toBe('(508) 555-0100')
    expect(maskPhoneInput('+55 11 91234-5678', '55')).toBe('(11) 91234-5678')
    expect(maskPhoneInput('15085550100', '1')).toBe('(508) 555-0100')
  })

  it('ignores letters and punctuation', () => {
    expect(maskPhoneInput('abc508-555.0100x', '1')).toBe('(508) 555-0100')
  })

  it('produces something normalizePhone accepts once complete, in the placeholder shape', () => {
    expect(normalizePhone(maskPhoneInput('5085550100', '1'), '1')).toBe('+15085550100')
    expect(normalizePhone(maskPhoneInput('11912345678', '55'), '55')).toBe('+5511912345678')
    expect(normalizePhone(maskPhoneInput('508740', '1'), '1')).toBeNull()
    expect(maskPhoneInput('00000000000', '55')).toBe(phonePlaceholderFor('55'))
  })

  it('leaves a country the picker does not offer as plain digits', () => {
    expect(maskPhoneInput('44 7911 123456', '44')).toBe('447911123456')
  })
})
