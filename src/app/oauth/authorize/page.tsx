// OAuth 2.0 Authorization endpoint (user-facing consent screen).
//
// External MCP clients (Claude, ChatGPT) redirect the user's browser here with:
//   ?response_type=code
//   &client_id=...
//   &redirect_uri=...
//   &code_challenge=...
//   &code_challenge_method=S256
//   &scope=mcp:all
//   &state=...
//
// We:
//   1. Validate the OAuth params + look up the client in mcp_oauth_clients
//   2. Require the user to be signed into Xphere (otherwise → /)
//   3. Render a consent screen showing what the app is asking for
//   4. On Allow: create a single-use code in mcp_oauth_codes and 302 to redirect_uri
//   5. On Deny: 302 to redirect_uri with error=access_denied

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { randomOpaqueToken, sha256Hex } from '@/lib/mcp/crypto'
import { formatEmailDisplay } from '@/lib/email-addresses/format'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RawClient {
  client_id: string
  name: string
  redirect_uris: string[]
  scope: string
}

async function loadClient(clientId: string): Promise<RawClient | null> {
  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('mcp_oauth_clients')
    .select('client_id, name, redirect_uris, scope')
    .eq('client_id', clientId)
    .maybeSingle()
  return (data as RawClient | null) ?? null
}

async function resolveOrgId(): Promise<string | null> {
  const jar = await cookies()
  const raw = jar.get('vo_active_org')?.value
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id?: string }
      if (parsed.id) return parsed.id
    } catch {
      // fall through
    }
  }
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_current_org_id')
  return (data as string | null) ?? null
}

function redirectWithError(redirectUri: string, error: string, state: string | undefined) {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (state) url.searchParams.set('state', state)
  redirect(url.toString())
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const responseType = String(sp.response_type ?? '')
  const clientId = String(sp.client_id ?? '')
  const redirectUri = String(sp.redirect_uri ?? '')
  const codeChallenge = String(sp.code_challenge ?? '')
  const codeChallengeMethod = String(sp.code_challenge_method ?? 'S256')
  const scope = String(sp.scope ?? 'mcp:all')
  const state = sp.state ? String(sp.state) : undefined

  if (responseType !== 'code' || !clientId || !redirectUri || !codeChallenge) {
    return (
      <ErrorShell title="Invalid OAuth request">
        Missing required parameters (response_type=code, client_id, redirect_uri, code_challenge).
      </ErrorShell>
    )
  }
  if (codeChallengeMethod !== 'S256') {
    return (
      <ErrorShell title="Unsupported code_challenge_method">
        Only S256 (PKCE) is supported.
      </ErrorShell>
    )
  }

  const client = await loadClient(clientId)
  if (!client) {
    return <ErrorShell title="Unknown OAuth client">No client registered with that id.</ErrorShell>
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    return (
      <ErrorShell title="redirect_uri mismatch">
        The redirect_uri is not registered for this client.
      </ErrorShell>
    )
  }

  const user = await getUser()
  if (!user) {
    // Send the user through login, returning here when done.
    const url = new URL('/oauth/authorize', 'https://placeholder')
    Object.entries(sp).forEach(([k, v]) => {
      if (typeof v === 'string') url.searchParams.set(k, v)
    })
    const path = `${url.pathname}${url.search}`
    redirect(`/?redirect_to=${encodeURIComponent(path)}`)
  }

  const orgId = await resolveOrgId()
  if (!orgId) {
    return (
      <ErrorShell title="No active organization">
        Pick an organization in Xphere before authorizing an external app.
      </ErrorShell>
    )
  }

  async function approve() {
    'use server'
    const u = await getUser()
    if (!u) redirect('/')

    const supabase = createServiceRoleClient()
    const codePlain = randomOpaqueToken(32)
    const codeHash = await sha256Hex(codePlain)
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('mcp_oauth_codes').insert({
      code_hash: codeHash,
      client_id: clientId,
      org_id: orgId,
      user_id: u!.id,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      scope,
      expires_at: expiresAt,
    })
    if (error) {
      redirectWithError(redirectUri, 'server_error', state)
    }

    const url = new URL(redirectUri)
    url.searchParams.set('code', codePlain)
    if (state) url.searchParams.set('state', state)
    redirect(url.toString())
  }

  async function deny() {
    'use server'
    redirectWithError(redirectUri, 'access_denied', state)
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-secondary shadow-2xl shadow-black/40 p-7">
        <div className="mb-1 text-[11px] uppercase tracking-widest text-text-tertiary">Authorize</div>
        <h1 className="text-[20px] font-semibold tracking-tight">
          {client.name}
        </h1>
        <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">
          wants to connect to your Xphere account and act on your behalf via the MCP API.
        </p>

        <div className="mt-5 rounded-xl border border-border-subtle bg-bg-tertiary/40 p-3.5 text-[12.5px]">
          <div className="text-text-tertiary mb-1.5 font-medium">It will be able to:</div>
          <ul className="space-y-1.5 text-text-secondary">
            <li>· Read contacts, opportunities, conversations and tasks</li>
            <li>· Read and update projects, tasks and execution runs</li>
            <li>· Read traffic analytics</li>
            <li>· Create comments, tasks and messages on your behalf</li>
          </ul>
        </div>

        <div className="mt-4 text-[11.5px] text-text-tertiary">
          Signed in as <span className="text-text-secondary">{formatEmailDisplay(user.email)}</span>.
          Actions are logged for audit.
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <form action={deny}>
            <button
              type="submit"
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-bg-tertiary"
            >
              Deny
            </button>
          </form>
          <form action={approve}>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover"
            >
              Authorize
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function ErrorShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-rose-900/40 bg-bg-secondary p-7">
        <div className="mb-1 text-[11px] uppercase tracking-widest text-rose-400">OAuth error</div>
        <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">{children}</p>
      </div>
    </div>
  )
}
