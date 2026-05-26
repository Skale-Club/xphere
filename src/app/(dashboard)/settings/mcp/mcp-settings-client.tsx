'use client'

import * as React from 'react'
import { Copy, RefreshCw, Eye, EyeOff, Loader2, Plug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { rotateOrCreateMcpToken, getDecryptedMcpToken } from '@/app/(dashboard)/projects/actions'
import type { McpTokenInfo } from '@/app/(dashboard)/projects/actions'

const XPHERE_ORIGIN = 'https://xphere.app'

interface Props {
  initialToken: McpTokenInfo | null
}

export function McpSettingsClient({ initialToken }: Props) {
  const [token, setToken] = React.useState<McpTokenInfo | null>(initialToken)
  const [revealed, setRevealed] = React.useState(false)
  const [fullToken, setFullToken] = React.useState<string | null>(null)
  const [rotating, setRotating] = React.useState(false)
  const [revealing, setRevealing] = React.useState(false)

  const mcpEndpoint = `${XPHERE_ORIGIN}/api/mcp`
  const oauthMetadata = `${XPHERE_ORIGIN}/.well-known/oauth-authorization-server`

  const displayToken = revealed && fullToken ? fullToken : (token?.masked ?? '—')

  async function handleReveal() {
    if (revealed) { setRevealed(false); return }
    if (fullToken) { setRevealed(true); return }
    setRevealing(true)
    try {
      const t = await getDecryptedMcpToken()
      if (t) { setFullToken(t); setRevealed(true) }
    } catch {
      toast.error('Failed to reveal token')
    } finally {
      setRevealing(false)
    }
  }

  async function handleCopyToken() {
    const t = fullToken ?? await getDecryptedMcpToken()
    if (!t) { toast.error('No token to copy'); return }
    if (!fullToken) setFullToken(t)
    await navigator.clipboard.writeText(t)
    toast.success('Token copied')
  }

  async function handleRotate() {
    if (!confirm('Rotate token? All existing integrations using the current token will stop working.')) return
    setRotating(true)
    try {
      const newToken = await rotateOrCreateMcpToken()
      if (newToken) {
        setToken(newToken)
        setFullToken(null)
        setRevealed(false)
        toast.success('Token rotated')
      }
    } catch {
      toast.error('Failed to rotate token')
    } finally {
      setRotating(false)
    }
  }

  async function handleGenerate() {
    setRotating(true)
    try {
      const newToken = await rotateOrCreateMcpToken()
      if (newToken) {
        setToken(newToken)
        toast.success('Token generated')
      }
    } catch {
      toast.error('Failed to generate token')
    } finally {
      setRotating(false)
    }
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  }

  return (
    <div className="space-y-6">
      {/* Token section */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Client Token</h2>
        </div>

        {token ? (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Token</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={displayToken}
                  className="font-mono text-sm h-9 flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-2.5 shrink-0"
                  onClick={handleReveal}
                  disabled={revealing}
                  title={revealed ? 'Hide' : 'Reveal'}
                >
                  {revealing ? <Loader2 className="h-4 w-4 animate-spin" /> : revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-2.5 shrink-0"
                  onClick={handleCopyToken}
                  title="Copy token"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-2.5 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleRotate}
                  disabled={rotating}
                  title="Rotate token"
                >
                  {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Keep this token secret. Rotate if compromised.</p>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No token generated yet.</p>
            <Button size="sm" onClick={handleGenerate} disabled={rotating}>
              {rotating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Generate token
            </Button>
          </div>
        )}
      </div>

      {/* MCP Endpoint */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <h2 className="text-sm font-medium">MCP Endpoint</h2>
        <p className="text-xs text-muted-foreground">
          Paste this URL into Claude (Add custom connector), ChatGPT (New App → MCP Server URL),
          or any MCP client. Two auth options:
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Remote MCP server URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={mcpEndpoint} className="font-mono text-xs h-8 flex-1 text-muted-foreground" />
              <Button variant="outline" size="sm" className="h-8 px-2.5 shrink-0" onClick={() => copyText(mcpEndpoint, 'MCP endpoint')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              OAuth metadata (auto-discovered by Claude / ChatGPT)
            </Label>
            <div className="flex gap-2">
              <Input readOnly value={oauthMetadata} className="font-mono text-xs h-8 flex-1 text-muted-foreground" />
              <Button variant="outline" size="sm" className="h-8 px-2.5 shrink-0" onClick={() => copyText(oauthMetadata, 'OAuth metadata URL')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-md bg-bg-tertiary/40 px-3 py-2.5 text-[12px] text-muted-foreground space-y-1.5 leading-relaxed">
          <p>
            <span className="font-medium text-text-secondary">OAuth (recommended for Claude / ChatGPT):</span>{' '}
            leave OAuth fields blank in the connector dialog — the server auto-registers (DCR) and
            asks you to authorize in-browser.
          </p>
          <p>
            <span className="font-medium text-text-secondary">Bearer token (CLI / scripts):</span>{' '}
            send the client token above as <code className="font-mono">Authorization: Bearer xph_…</code>.
          </p>
        </div>
      </div>
    </div>
  )
}
