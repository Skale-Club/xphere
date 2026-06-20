import { describe, it, expect } from 'vitest'
import { evaluateMathExpression } from '@/lib/agent-runtime/builtin-tools'

describe('evaluateMathExpression: arithmetic', () => {
  it('adds and subtracts left-to-right', () => {
    expect(evaluateMathExpression('1 + 2 - 3')).toBe(0)
  })
  it('respects * / over + -', () => {
    expect(evaluateMathExpression('2 + 3 * 4')).toBe(14)
  })
  it('honors parentheses', () => {
    expect(evaluateMathExpression('(2 + 3) * 4')).toBe(20)
  })
  it('handles the percentage-style example', () => {
    expect(evaluateMathExpression('(1290.5 * 3) * 1.07')).toBeCloseTo(4142.505, 3)
  })
  it('supports modulo', () => {
    expect(evaluateMathExpression('10 % 3')).toBe(1)
  })
  it('supports decimals and scientific notation', () => {
    expect(evaluateMathExpression('1.5e3 + 0.5')).toBe(1500.5)
  })
})

describe('evaluateMathExpression: power and unary', () => {
  it('is right-associative for ^', () => {
    expect(evaluateMathExpression('2 ^ 3 ^ 2')).toBe(512) // 2^(3^2)
  })
  it('binds power tighter than unary minus', () => {
    expect(evaluateMathExpression('-2 ^ 2')).toBe(-4) // -(2^2)
  })
  it('allows a signed exponent', () => {
    expect(evaluateMathExpression('2 ^ -1')).toBe(0.5)
  })
  it('handles leading unary minus', () => {
    expect(evaluateMathExpression('-5 + 3')).toBe(-2)
  })
})

describe('evaluateMathExpression: functions and constants', () => {
  it('evaluates sqrt', () => {
    expect(evaluateMathExpression('sqrt(144)')).toBe(12)
  })
  it('evaluates variadic max', () => {
    expect(evaluateMathExpression('max(1, 7, 3)')).toBe(7)
  })
  it('evaluates pow with two args', () => {
    expect(evaluateMathExpression('pow(2, 10)')).toBe(1024)
  })
  it('evaluates two-arg log as log base', () => {
    expect(evaluateMathExpression('log(8, 2)')).toBe(3)
  })
  it('exposes pi', () => {
    expect(evaluateMathExpression('pi')).toBeCloseTo(Math.PI, 10)
  })
  it('nests functions', () => {
    expect(evaluateMathExpression('round(sqrt(2) * 100)')).toBe(141)
  })
})

describe('evaluateMathExpression: rejects unsafe / invalid input', () => {
  it('throws on arbitrary identifiers (no code execution)', () => {
    expect(() => evaluateMathExpression('process')).toThrow()
  })
  it('throws on unknown functions', () => {
    expect(() => evaluateMathExpression('alert(1)')).toThrow()
  })
  it('throws on JS injection attempts', () => {
    expect(() => evaluateMathExpression('1; while(true){}')).toThrow()
  })
  it('throws on division by zero (non-finite)', () => {
    expect(() => evaluateMathExpression('1 / 0')).toThrow()
  })
  it('throws on empty expression', () => {
    expect(() => evaluateMathExpression('')).toThrow()
  })
  it('throws on trailing garbage', () => {
    expect(() => evaluateMathExpression('2 + 2 foo')).toThrow()
  })
  it('throws on unbalanced parentheses', () => {
    expect(() => evaluateMathExpression('(1 + 2')).toThrow()
  })
})
