import { vi } from 'vitest'

// Next.js font functions do not run in vitest's node environment
vi.mock('next/font/google', () => ({
  Inter: () => ({ className: 'inter', variable: '--font-sans' }),
  JetBrains_Mono: () => ({ className: 'jetbrains-mono', variable: '--font-mono' }),
}))

// Import after mocking
const { metadata } = await import('@/app/layout')

describe('Brand rename — layout metadata', () => {
  it('sets title to Operator', () => {
    expect(metadata.title).toBe('Operator')
  })

  it('sets description to AI Operations Platform', () => {
    expect(metadata.description).toBe('AI Operations Platform')
  })
})
