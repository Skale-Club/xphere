/** @vitest-environment jsdom */
import { Component, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), assign: vi.fn(), toast: vi.fn(), legacySwitch: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/org/navigation', () => ({ usePathname: () => '/settings/integrations' }))
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }))
vi.mock('@/app/(dashboard)/organizations/actions', () => ({
  getUserOrgs: vi.fn(), createOrganization: vi.fn(), switchOrganization: mocks.legacySwitch,
}))
// Only simplify presentation. Exercise the real switcher's click and transition.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <>{children}</>
  return { DropdownMenu: Wrapper, DropdownMenuContent: Wrapper,
    DropdownMenuItem: Wrapper, DropdownMenuTrigger: Wrapper, DropdownMenuSeparator: () => null }
})
vi.mock('@/components/ui/dialog', () => ({
  Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null,
}))
import { OrgSwitcher } from '@/components/layout/org-switcher'

const A = '24552ef3-de77-4fba-a2c3-148cd58d8750'
const B = '61a5dfb8-6eb0-4304-84ff-22e0d77afc2c'
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p>Something went wrong.</p> : this.props.children }
}
let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const realWindow = window
  vi.stubGlobal('window', new Proxy(realWindow, {
    get(target, prop) {
      if (prop === 'location') return { assign: mocks.assign }
      return Reflect.get(target, prop)
    },
  }))
  vi.stubGlobal('fetch', mocks.fetch)
  // The old server action can fail while re-rendering the page AFTER saving
  // the new org. A refresh then works, as in the reported production failure.
  mocks.legacySwitch.mockRejectedValue(new Error('Old page failed during org switch'))
  mocks.fetch.mockResolvedValue(Response.json({ ok: true }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container, { onCaughtError: () => {} })
  await act(async () => root.render(<Boundary><OrgSwitcher
    currentOrgId={A} currentOrgName="First" initialOrgs={[
      { id: A, name: 'First', logo_url: null }, { id: B, name: 'Second', logo_url: null },
    ]}
  /></Boundary>))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function select(orgId = B) {
  const link = container.querySelector<HTMLAnchorElement>(`a[href^="/o/${orgId}"]`)!
  await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}
describe('switching organizations from an existing page', () => {
  it('loads the new org without re-rendering the old integrations page via a server action', async () => {
    await select()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/org/default', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ orgId: B }),
    }))
    expect(mocks.legacySwitch).not.toHaveBeenCalled()
    expect(mocks.assign).toHaveBeenCalledWith(`/o/${B}/dashboard`)
    expect(container.textContent).not.toContain('Something went wrong.')
  })
  it('waits for confirmation before navigating', async () => {
    let finish!: (response: Response) => void
    mocks.fetch.mockReturnValue(new Promise<Response>(resolve => { finish = resolve }))
    await select()
    expect(mocks.assign).not.toHaveBeenCalled()
    await act(async () => finish(Response.json({ ok: true })))
    expect(mocks.assign).toHaveBeenCalledOnce()
  })
  it('shows rejected membership in place and keeps the current org', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ error: 'Not a member' }, { status: 403 }))
    await select()
    expect(mocks.toast).toHaveBeenCalledWith('Not a member')
    expect(mocks.assign).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Something went wrong.')
  })
  it.each(['offline', 'invalid response'])('keeps the screen usable on %s', async (failure) => {
    if (failure === 'offline') mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    else mocks.fetch.mockResolvedValue(new Response('<html>Unavailable</html>', { status: 502 }))
    await select()
    expect(mocks.toast).toHaveBeenCalledWith('Could not switch organization. Please try again.')
    expect(mocks.assign).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Something went wrong.')
  })
  it('does nothing when selecting the current organization', async () => {
    await select(A)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.assign).not.toHaveBeenCalled()
  })
})
