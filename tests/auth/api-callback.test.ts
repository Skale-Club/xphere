import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    redirect: vi.fn((url: string | URL) => ({ type: 'redirect', url: String(url) })),
  },
  NextRequest: class {},
}))

import { GET } from '@/app/api/auth/callback/route'

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('forwards OAuth codes to the canonical auth callback with dashboard as the default next path', async () => {
    const request = new Request('https://xphere.app/api/auth/callback?code=abc123')
    const response = await GET(request as never)

    expect(response.url).toBe('https://xphere.app/auth/callback?code=abc123&next=%2Fdashboard')
  })

  it('preserves an explicit next path when forwarding to the canonical callback', async () => {
    const request = new Request('https://xphere.app/api/auth/callback?code=abc123&next=/chat')
    const response = await GET(request as never)

    expect(response.url).toBe('https://xphere.app/auth/callback?code=abc123&next=%2Fchat')
  })
})
