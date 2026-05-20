'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Search,
} from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ToolPickerData } from '@/app/(dashboard)/agents/actions'

interface ToolPickerProps {
  data: ToolPickerData
  value: string[] // currently selected tool_config_ids
  onChange: (next: string[]) => void
}

type ToolRow = ToolPickerData['tools'][number]

/**
 * Folder-grouped, multi-select tool picker for the agent edit form.
 * D-36-05 / TOOL-02 / TOOL-04.
 *
 * - Tools grouped by `folder_id` (null bucket = "Unfiled")
 * - Folders are collapsible; default open
 * - Each row: checkbox + tool name + type badge + integration name + warning
 *   icon if integration is inactive/missing (still selectable per TOOL-04)
 * - Client-side search filters by name/type/integration name
 * - NO drag-and-drop, rename, or add-folder UI (RESEARCH §5 — picker reuses
 *   existing folder hierarchy in read-only mode)
 */
export function ToolPicker({ data, value, onChange }: ToolPickerProps) {
  const [search, setSearch] = useState('')
  const [openFolders, setOpenFolders] = useState<Set<string | null>>(
    () => new Set<string | null>([...data.folders.map((f) => f.id), null])
  )

  const selected = useMemo(() => new Set(value), [value])

  // Filter tools by search (client-side)
  const filteredTools = useMemo<ToolRow[]>(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data.tools
    return data.tools.filter(
      (t) =>
        t.tool_name.toLowerCase().includes(q) ||
        (t.action_type ?? '').toLowerCase().includes(q) ||
        (t.integration?.name ?? '').toLowerCase().includes(q)
    )
  }, [data.tools, search])

  // Group tools by folder_id (null = Unfiled bucket)
  const toolsByFolder = useMemo(() => {
    const map = new Map<string | null, ToolRow[]>()
    for (const t of filteredTools) {
      const key = t.folder_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return map
  }, [filteredTools])

  function toggleFolder(folderId: string | null) {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  function toggleTool(toolId: string) {
    const next = new Set(selected)
    if (next.has(toolId)) next.delete(toolId)
    else next.add(toolId)
    onChange([...next])
  }

  function renderFolderSection(folderId: string | null, label: string) {
    const tools = toolsByFolder.get(folderId)
    if (!tools || tools.length === 0) return null
    const isOpen = openFolders.has(folderId)
    return (
      <Collapsible
        key={folderId ?? '__unfiled'}
        open={isOpen}
        onOpenChange={() => toggleFolder(folderId)}
      >
        <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-sm font-medium hover:bg-muted/50 px-2 rounded">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span>{label}</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {tools.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-6 space-y-1">
          {tools.map((tool) => {
            const integrationActive =
              tool.integration?.is_active !== false &&
              tool.integration?.id != null
            return (
              <label
                key={tool.id}
                className="flex items-center gap-2 py-1.5 text-sm cursor-pointer hover:bg-muted/30 rounded px-2"
              >
                <Checkbox
                  checked={selected.has(tool.id)}
                  onCheckedChange={() => toggleTool(tool.id)}
                />
                <span className="font-medium">{tool.tool_name}</span>
                <Badge variant="outline" className="text-xs">
                  {tool.action_type}
                </Badge>
                {tool.integration && (
                  <span className="text-xs text-muted-foreground">
                    · {tool.integration.name ?? 'No integration'}
                  </span>
                )}
                {!integrationActive && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">
                          Integration missing or inactive. Tool will fail at
                          runtime.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <Link
                  href={`/workflows/${tool.id}`}
                  target="_blank"
                  rel="noopener"
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </label>
            )
          })}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter tools..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <div className="border rounded-md max-h-96 overflow-y-auto">
        {data.folders.map((f) => renderFolderSection(f.id, f.name))}
        {renderFolderSection(null, 'Unfiled')}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.size} of {data.tools.length} tools selected.
      </p>
    </div>
  )
}
