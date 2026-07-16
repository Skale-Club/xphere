import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Signature, Plus, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getUser } from '@/lib/supabase/server'
import { listSignatures } from './actions'
import { SignatureListActions } from './_components/signature-list-actions'
import { formatDistanceToNow } from 'date-fns'

export default async function SettingsSignaturesPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const result = await listSignatures()
  const signatures = result.ok ? result.data : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Email Signatures</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Build reusable HTML signatures — appended to outbound replies and ready to paste into Gmail or Outlook.
          </p>
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/settings/signatures/new">
            <Plus className="h-3.5 w-3.5" /> New Signature
          </Link>
        </Button>
      </div>

      {/* Empty state */}
      {signatures.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <Signature className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium mb-1">No signatures yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first signature with the HTML editor.
          </p>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/settings/signatures/new">
              <Plus className="h-3.5 w-3.5" /> New Signature
            </Link>
          </Button>
        </div>
      )}

      {/* Grid */}
      {signatures.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {signatures.map((sig) => (
            <div
              key={sig.id}
              className="rounded-lg border border-border bg-card hover:border-border/80 transition-colors flex flex-col"
            >
              {/* Preview area */}
              <Link
                href={`/settings/signatures/${sig.id}`}
                className="block h-32 rounded-t-lg bg-white overflow-hidden border-b border-border"
              >
                {sig.html_snapshot ? (
                  <div className="w-full h-full pointer-events-none overflow-hidden p-3">
                    <div
                      className="origin-top-left scale-[0.55] w-[182%]"
                      dangerouslySetInnerHTML={{ __html: sig.html_snapshot }}
                    />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Signature className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                )}
              </Link>

              {/* Card footer */}
              <div className="p-3 flex flex-col gap-2 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/settings/signatures/${sig.id}`}
                    className="text-sm font-medium leading-tight hover:underline line-clamp-2 flex-1"
                  >
                    {sig.name}
                  </Link>
                  {sig.is_default && (
                    <Badge variant="secondary" className="text-[10px] shrink-0 gap-1 bg-amber-500/15 text-amber-500">
                      <Star className="h-2.5 w-2.5 fill-current" />
                      Default
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Updated {formatDistanceToNow(new Date(sig.updated_at), { addSuffix: true })}
                  </p>
                  <SignatureListActions signatureId={sig.id} isDefault={sig.is_default} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
