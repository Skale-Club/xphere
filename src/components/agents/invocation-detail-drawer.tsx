'use client'

// src/components/agents/invocation-detail-drawer.tsx
// Phase 40 OBS-07: Dialog showing delegation tree for a single invocation.
// Opened when user clicks an invocation row in InvocationsList.
// fetchTree is passed as a server action function prop (bridge pattern).

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DelegationTree } from '@/components/conversations/delegation-tree'
import type { InvocationTreeNode } from '@/lib/agent-runtime/observability'

interface InvocationDetailDrawerProps {
  invocationId: string
  open: boolean
  onClose: () => void
  fetchTree: (id: string) => Promise<InvocationTreeNode[]>
}

export function InvocationDetailDrawer({
  invocationId,
  open,
  onClose,
  fetchTree,
}: InvocationDetailDrawerProps) {
  const [tree, setTree] = useState<InvocationTreeNode[] | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch tree when dialog opens or invocationId changes
  useEffect(() => {
    if (!open) return
    setTree(null)
    setLoading(true)
    fetchTree(invocationId)
      .then(setTree)
      .catch(() => setTree([]))
      .finally(() => setLoading(false))
  }, [open, invocationId, fetchTree])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Invocation Detail
          </DialogTitle>
          <p className="text-xs text-muted-foreground font-mono mt-1 break-all">
            {invocationId}
          </p>
        </DialogHeader>
        <div className="mt-4">
          {loading && (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted rounded-lg" />
              ))}
            </div>
          )}
          {!loading && tree !== null && <DelegationTree roots={tree} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
