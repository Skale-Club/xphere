'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Blocks,
  Code2,
  Copy,
  Download,
  Eye,
  Loader2,
  Save,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  makeBlockId,
  renderSignatureFragment,
  type EmailDocument,
} from '@/lib/email/render-template'
import type { EmailSignatureRow } from '@/types/database'
import { saveSignature, setDefaultSignature, deleteSignature } from '../actions'

interface Props {
  signature: EmailSignatureRow
}

const STARTER_HTML = `<table cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <tr>
    <td style="padding-right:14px;vertical-align:top;">
      <img src="https://via.placeholder.com/56" width="56" height="56" alt="" style="border-radius:6px;display:block;" />
    </td>
    <td style="vertical-align:top;line-height:1.5;">
      <strong style="font-size:15px;">Your Name</strong><br />
      <span style="color:#666;">Your Role · Company</span><br />
      <a href="mailto:you@company.com" style="color:#2563eb;text-decoration:none;">you@company.com</a>
    </td>
  </tr>
</table>`

/** Wrap a raw-HTML string in the single-html-block document shape the renderer
 *  and save pipeline expect. Transparent background + zero padding so the
 *  fragment is exactly the user's HTML, width-capped, with no card chrome. */
function buildDocument(rawHtml: string): EmailDocument {
  return {
    contentWidth: 500,
    fontFamily: 'Arial, sans-serif',
    sections: [
      {
        id: makeBlockId(),
        layout: 1,
        backgroundColor: 'transparent',
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        columns: [[{ id: makeBlockId(), blockType: 'html', content: rawHtml }]],
      },
    ],
  }
}

/**
 * Decide what to show in the raw-HTML textarea for a stored signature.
 *  - HTML-authored (single html block) → edit that block's content directly.
 *  - Visually built (has non-html blocks) → show the compiled snapshot so the
 *    textarea reflects the real signature, and flag it so we can warn that
 *    saving here replaces the visual layout.
 *  - Empty → seed with a starter template.
 */
function analyzeSignatureDoc(
  document: Record<string, unknown>,
  htmlSnapshot: string | null,
): { html: string; builtVisually: boolean } {
  const sections = (document?.sections as EmailDocument['sections']) ?? []
  let htmlBlock: string | null = null
  let hasOtherBlocks = false
  for (const section of sections) {
    for (const col of section.columns ?? []) {
      for (const block of col) {
        if (block.blockType === 'html' && typeof block.content === 'string') {
          if (htmlBlock === null) htmlBlock = block.content
        } else {
          hasOtherBlocks = true
        }
      }
    }
  }
  if (hasOtherBlocks) {
    return { html: htmlSnapshot ?? htmlBlock ?? '', builtVisually: true }
  }
  if (htmlBlock !== null) return { html: htmlBlock, builtVisually: false }
  return { html: STARTER_HTML, builtVisually: false }
}

export function SignatureEditor({ signature }: Props) {
  const router = useRouter()

  const analysis = useMemo(
    () => analyzeSignatureDoc(signature.document, signature.html_snapshot),
    [signature.document, signature.html_snapshot],
  )
  const [name, setName] = useState(signature.name)
  const [rawHtml, setRawHtml] = useState(analysis.html)
  const builtVisually = analysis.builtVisually
  const [isDefault, setIsDefault] = useState(signature.is_default)
  const [dirty, setDirty] = useState(false)

  const [isSaving, startSave] = useTransition()
  const [isDefaulting, startDefault] = useTransition()
  const [isDeleting, startDelete] = useTransition()

  // Client-side render of exactly what the save pipeline will store (minus the
  // server sanitize pass). Shown in a sandboxed iframe so any script the user
  // pastes cannot execute in the dashboard.
  const preview = useMemo(() => renderSignatureFragment(buildDocument(rawHtml)), [rawHtml])

  const doSave = useCallback(
    (opts?: { silent?: boolean }): Promise<string | null> =>
      new Promise((resolve) => {
        startSave(async () => {
          const res = await saveSignature(signature.id, buildDocument(rawHtml), name)
          if (!res.ok) {
            toast.error(res.error)
            resolve(null)
            return
          }
          setDirty(false)
          if (!opts?.silent) toast.success('Signature saved')
          router.refresh()
          resolve(res.data.html_snapshot)
        })
      }),
    [signature.id, rawHtml, name, router],
  )

  function onToggleDefault() {
    startDefault(async () => {
      const next = !isDefault
      const res = await setDefaultSignature(signature.id, next)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setIsDefault(next)
      toast.success(next ? 'Set as org default' : 'Default cleared')
      router.refresh()
    })
  }

  function onDelete() {
    if (!confirm('Delete this signature? This cannot be undone.')) return
    startDelete(async () => {
      const res = await deleteSignature(signature.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Signature deleted')
      router.push('/settings/signatures')
    })
  }

  async function copyForGmail() {
    // Save first so we copy the canonical sanitized HTML, not raw input.
    const savedHtml = dirty ? await doSave({ silent: true }) : signature.html_snapshot ?? preview.html
    const html = savedHtml ?? preview.html
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([preview.plainText], { type: 'text/plain' }),
          }),
        ])
        toast.success('Copied — paste into Gmail/Outlook signature settings')
        return
      }
      await navigator.clipboard.writeText(html)
      toast.success('Copied HTML source (rich copy unsupported here)')
    } catch {
      toast.error('Copy failed — use "Copy HTML" instead')
    }
  }

  async function copyHtmlSource() {
    try {
      await navigator.clipboard.writeText(rawHtml)
      toast.success('HTML source copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  function downloadHtml() {
    const blob = new Blob([preview.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'signature'}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      {/* Top bar */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => router.push('/settings/signatures')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(true)
          }}
          className="max-w-xs font-medium"
          maxLength={120}
          aria-label="Signature name"
        />
        {isDefault && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-500">
            <Star className="h-3 w-3 fill-current" /> Default
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/settings/signatures/${signature.id}/build`)}
            className="gap-1.5"
          >
            <Blocks className="h-3.5 w-3.5" /> Visual builder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleDefault}
            disabled={isDefaulting}
            className="gap-1.5"
          >
            {isDefaulting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className={`h-3.5 w-3.5 ${isDefault ? 'fill-current text-amber-400' : ''}`} />}
            {isDefault ? 'Unset default' : 'Set default'}
          </Button>
          <Button size="sm" onClick={() => doSave()} disabled={isSaving} className="gap-1.5">
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>

      {builtVisually && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This signature was made in the <strong>visual builder</strong>. The HTML below is its compiled output —
            saving here converts it to raw HTML and replaces the visual layout. Use the visual builder to keep editing
            blocks.
          </span>
        </div>
      )}

      {/* Editor + preview */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <Code2 className="h-3.5 w-3.5" /> HTML
          </Label>
          <Textarea
            value={rawHtml}
            onChange={(e) => {
              setRawHtml(e.target.value)
              setDirty(true)
            }}
            spellCheck={false}
            className="min-h-[380px] font-mono text-xs leading-relaxed"
            placeholder="Paste or write your signature HTML…"
          />
          <p className="text-xs text-muted-foreground">
            Use email-safe HTML (tables + inline styles). On save it&apos;s sanitized (scripts/handlers stripped) and
            compiled to a paste-ready fragment.
          </p>
        </div>

        <div className="space-y-2">
          <Tabs defaultValue="preview">
            <TabsList className="h-8">
              <TabsTrigger value="preview" className="gap-1.5 text-xs">
                <Eye className="h-3.5 w-3.5" /> Preview
              </TabsTrigger>
              <TabsTrigger value="source" className="gap-1.5 text-xs">
                <Code2 className="h-3.5 w-3.5" /> Rendered source
              </TabsTrigger>
            </TabsList>
            <TabsContent value="preview">
              <div className="rounded-md border border-border bg-white p-4 min-h-[340px] overflow-auto">
                <iframe
                  title="Signature preview"
                  sandbox=""
                  className="w-full min-h-[300px] border-0"
                  srcDoc={`<!doctype html><html><body style="margin:0;font-family:Arial,sans-serif;">${preview.html}</body></html>`}
                />
              </div>
            </TabsContent>
            <TabsContent value="source">
              <pre className="rounded-md border border-border bg-muted/40 p-3 min-h-[340px] overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                {preview.html}
              </pre>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Export bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
        <span className="text-xs font-medium text-muted-foreground mr-1">Use externally:</span>
        <Button variant="outline" size="sm" onClick={copyForGmail} className="gap-1.5">
          <Copy className="h-3.5 w-3.5" /> Copy for Gmail/Outlook
        </Button>
        <Button variant="outline" size="sm" onClick={copyHtmlSource} className="gap-1.5">
          <Code2 className="h-3.5 w-3.5" /> Copy HTML
        </Button>
        <Button variant="outline" size="sm" onClick={downloadHtml} className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Download .html
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={isDeleting}
          className="ml-auto gap-1.5 text-destructive hover:text-destructive"
        >
          {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Delete
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Paste into Gmail:</strong> Settings → See all settings → General → Signature → paste. &nbsp;
        <strong>Outlook:</strong> Settings → Mail → Compose and reply → Email signature.
      </p>
    </div>
  )
}
