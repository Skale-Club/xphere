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

  const mcpGeneral = `${XPHERE_ORIGIN}/api/mcp/general`
  const mcpProjects = `${XPHERE_ORIGIN}/api/mcp/projects`

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

      {/* MCP Links */}
      {token && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <h2 className="text-sm font-medium">MCP Links</h2>
          <p className="text-xs text-muted-foreground">Use these links in your MCP client configuration. Both use the same token above.</p>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">General Xphere MCP</Label>
              <div className="flex gap-2">
                <Input readOnly value={mcpGeneral} className="font-mono text-xs h-8 flex-1 text-muted-foreground" />
                <Button variant="outline" size="sm" className="h-8 px-2.5 shrink-0" onClick={() => copyText(mcpGeneral, 'General MCP link')}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Projects MCP</Label>
              <div className="flex gap-2">
                <Input readOnly value={mcpProjects} className="font-mono text-xs h-8 flex-1 text-muted-foreground" />
                <Button variant="outline" size="sm" className="h-8 px-2.5 shrink-0" onClick={() => copyText(mcpProjects, 'Projects MCP link')}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
