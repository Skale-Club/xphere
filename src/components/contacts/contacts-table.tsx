"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  X,
  Trash2,
  MoreHorizontal,
  Upload,
  History,
  Download,
  Plus,
  AlertTriangle,
} from "lucide-react";
import { isValidEmail } from "@/lib/contacts/zod-schemas";
import { toast } from "sonner";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchInput } from "@/components/ui/search-input";
import {
  FilterPill,
  FilterPopover,
  FilterPopoverHeader,
  FilterSection,
} from "@/components/data-table/filter-popover";
import { NewContactDialog } from "./new-contact-dialog";
import { CustomFieldsFilterBar } from "@/components/custom-fields/custom-fields-filter-bar";
import {
  deleteContacts,
  exportContactsCsv,
} from "@/app/(dashboard)/contacts/actions";
import { SortableColumnHeader } from "@/components/data-table/sortable-column-header";
import { ImportWizardDialog } from "./import-wizard-dialog";
import type { Database } from "@/types/database";
import type { TagRow } from "@/app/(dashboard)/settings/tags/actions";
import type { CustomFieldDefinitionRow } from "@/app/(dashboard)/settings/custom-fields/actions";
import { FIELD_RENDER_CONFIG } from "@/lib/custom-fields/render-config";
import { CONTACT_SOURCES } from "@/lib/contacts/zod-schemas";
import type { CustomFieldType } from "@/types/database";
import { formatPhoneDisplay } from "@/lib/phone-numbers/format";
import { formatEmailDisplay } from "@/lib/email-addresses/format";
import { PhoneDisplay } from "@/components/phone/phone-display";

import {
  displayContactName,
  initialsFromContactName,
} from "@/lib/contacts/names";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useBreadcrumbOverride } from "@/components/layout/breadcrumb-override-context";
import { DndBadge } from "@/components/contacts/dnd-badge";

type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];

interface ContactsTableProps {
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  allTags: TagRow[];
  currentTag?: string;
  currentSource?: string;
  currentSort: string;
  currentQuery?: string;
  visibleDefs?: CustomFieldDefinitionRow[];
  filterableDefs?: CustomFieldDefinitionRow[];
  activeCfFilters?: Record<string, string>;
  /** Phase 110 CID-15: conflict counter for the filter chip. 0 → disabled. */
  conflictCount?: number;
  /** Phase 110 CID-15: current identity_status filter (URL-driven). */
  currentIdentityStatus?:
    | "channel_only"
    | "identified"
    | "verified"
    | "merge_conflict";
  /* addButton removed — rendered inline to avoid hydration fragility */
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ContactsTable({
  rows,
  total,
  page,
  pageSize,
  allTags,
  currentTag,
  currentSource,
  currentSort,
  currentQuery,
  visibleDefs = [],
  filterableDefs = [],
  activeCfFilters = {},
  conflictCount = 0,
  currentIdentityStatus,
}: ContactsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setSuffix } = useBreadcrumbOverride();

  React.useEffect(() => {
    setSuffix(<Badge variant="secondary">{total}</Badge>);
    return () => setSuffix(null);
  }, [total, setSuffix]);

  const [query, setQuery] = React.useState(currentQuery ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Optimistic "pending delete" set | rows fade out immediately on delete
  // and snap back if the server returns an error.
  const [pendingDelete, setPendingDelete] = React.useState<Set<string>>(
    new Set(),
  );

  // Reset selection when rows change
  React.useEffect(() => {
    setSelected(new Set());
    setPendingDelete(new Set());
  }, [rows]);

  // Debounced search → URL
  React.useEffect(() => {
    if ((currentQuery ?? "") === query) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) params.set("q", query);
      else params.delete("q");
      params.delete("page");
      router.replace(`${pathname}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "page") params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function clearUnifiedFilters() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("source");
    params.delete("tag");
    for (const key of Array.from(params.keys())) {
      if (key.startsWith("cff_")) params.delete(key);
    }
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length && rows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} contact(s)? This cannot be undone.`))
      return;
    const ids = [...selected];
    // Optimistic: mark rows as pending-delete so they fade out instantly.
    setPendingDelete(new Set(ids));
    const res = await deleteContacts(ids);
    if (res.error) {
      // Rollback the visual change on error.
      setPendingDelete(new Set());
      toast.error(res.error);
      return;
    }
    toast.success(`Deleted ${res.deleted ?? 0} contact(s)`);
    setSelected(new Set());
    router.refresh();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeCustomFilterCount = Object.entries(activeCfFilters).filter(
    ([key, value]) =>
      Boolean(value) && filterableDefs.some((def) => def.key === key),
  ).length;
  const filterActiveCount =
    [currentTag, currentSource].filter(Boolean).length +
    activeCustomFilterCount;
  const showFilters = Boolean(
    currentTag || currentSource || activeCustomFilterCount > 0,
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar — single line on all breakpoints */}
      <div className="animate-fade-in flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <NewContactDialog
          trigger={
            <Button size="sm" className="h-8">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Contact</span>
            </Button>
          }
        />

        <SearchInput
          value={query}
          onValueChange={setQuery}
          onClear={() => setQuery("")}
          placeholder="Search name, phone, email, company..."
        />

        <div className="hidden sm:block flex-1" />

        <ContactsFilterPopover
          activeCount={filterActiveCount}
          allTags={allTags}
          currentTag={currentTag}
          currentSource={currentSource}
          filterableDefs={filterableDefs}
          activeCfFilters={activeCfFilters}
          setParam={setParam}
          onClear={clearUnifiedFilters}
        />

        {/*
          Phase 110 CID-15 / D-08: Conflicts filter chip.
          - count=0  → disabled (opacity-50, no pointer events) per Open Question 1
          - count>0  → toggles ?identity_status=merge_conflict URL param
          Single canonical param (Pitfall 5 — no ?conflicts=1 flag).
        */}
        <ConflictsChip
          count={conflictCount}
          active={currentIdentityStatus === "merge_conflict"}
          onToggle={() =>
            setParam(
              "identity_status",
              currentIdentityStatus === "merge_conflict"
                ? null
                : "merge_conflict",
            )
          }
        />

        {/* More actions dropdown — all breakpoints */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="h-8 px-2.5">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={async () => {
                const res = await exportContactsCsv();
                if (res.error) {
                  toast.error(res.error);
                  return;
                }
                if (!res.csv) return;
                const blob = new Blob([res.csv], {
                  type: "text/csv;charset=utf-8;",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "contacts.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-3.5 w-3.5 mr-2" /> Export CSV
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <ImportWizardDialog
                trigger={
                  <span className="inline-flex items-center">
                    <Upload className="h-3.5 w-3.5 mr-2" /> Import CSV
                  </span>
                }
              />
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/contacts/imports"
                className="inline-flex items-center"
              >
                <History className="h-3.5 w-3.5 mr-2" /> History
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Pagination — inline with the toolbar */}
        {totalPages > 1 && (
          <PaginationControls
            page={page}
            totalPages={totalPages}
            total={total}
            onPage={(p) => setParam("page", String(p))}
            align="end"
          />
        )}
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-2 space-y-4">

        {/* Bulk actions bar */}
        {selected.size > 0 && (
          <div className="flex items-center justify-between rounded-[10px] border border-accent/30 bg-accent-muted/40 px-3 py-2">
            <span className="text-[12.5px] text-text-primary">
              {selected.size} selected
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleBulkDelete}
              className="text-rose-400 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}

        {/* Mobile list */}
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden sm:hidden">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-text-secondary">
              {showFilters || currentQuery
                ? "No contacts match your filters."
                : "No contacts to show yet."}
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {rows.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/chat?contact=${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/chat?contact=${c.id}`);
                    }
                  }}
                  className={cn(
                    "grid grid-cols-[28px_32px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-3 cursor-pointer",
                    "transition-all duration-200 ease-out hover:bg-bg-tertiary/40 focus:outline-none focus-visible:bg-bg-tertiary/40",
                    pendingDelete.has(c.id) &&
                      "opacity-30 -translate-x-2 pointer-events-none",
                  )}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggleRow(c.id)}
                      aria-label={`Select ${displayContactName(c, "contact")}`}
                    />
                  </div>
                  <Avatar className="h-8 w-8 shrink-0">
                    {c.avatar_url ? <AvatarImage src={c.avatar_url} alt="" /> : null}
                    <AvatarFallback className="text-[11px] font-semibold bg-accent-muted text-accent">
                      {initialsFromContactName(c, c.email ?? c.phone ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-text-primary">
                      <span className="truncate">{displayContactName(c, "") || (
                        <span className="italic text-text-tertiary">
                          Unnamed
                        </span>
                      )}</span>
                      <DndBadge dndEnabled={Boolean(c.dnd_enabled)} dndChannels={c.dnd_channels ?? []} />
                    </div>
                    <div className="mt-0.5 truncate text-[11.5px] text-text-tertiary">
                      {c.company || formatEmailDisplay(c.email) || (c.phone ? formatPhoneDisplay(c.phone) : null) || "No contact details"}
                    </div>
                    {c.tags.length > 0 && (
                      <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                        {c.tags.slice(0, 2).map((tagName) => {
                          const tagObj = allTags.find(
                            (t) =>
                              t.name === tagName ||
                              t.slug === tagName.toLowerCase(),
                          );
                          return (
                            <span
                              key={tagName}
                              className="inline-flex max-w-[120px] items-center truncate rounded-full bg-accent-muted px-1.5 py-0.5 text-[10px] font-medium text-accent"
                              style={
                                tagObj
                                  ? {
                                      backgroundColor: `${tagObj.color}22`,
                                      color: tagObj.color,
                                    }
                                  : undefined
                              }
                            >
                              {tagName}
                            </span>
                          );
                        })}
                        {c.tags.length > 2 && (
                          <span className="text-[10px] text-text-tertiary">
                            +{c.tags.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="self-start pt-1 text-right text-[11.5px] text-text-tertiary whitespace-nowrap">
                    {relativeTime(c.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden rounded-[12px] border border-border bg-bg-secondary overflow-hidden sm:block">
          <div
            className="grid items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
            style={{
              gridTemplateColumns: `40px 2fr 1.5fr 1.2fr 1fr${visibleDefs.map(() => " 1fr").join("")} 100px`,
            }}
          >
            <Checkbox
              checked={selected.size === rows.length && rows.length > 0}
              onCheckedChange={toggleAll}
              aria-label="Select all"
            />
            <SortableColumnHeader column="name" label="Contact" />
            <SortableColumnHeader column="phone" label="Phone" />
            <SortableColumnHeader column="email" label="Email" />
            <div>Tags</div>
            {visibleDefs.map((def) => (
              <div key={def.id}>{def.label}</div>
            ))}
            <div className="text-right">
              <SortableColumnHeader column="created_at" label="Added" />
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-text-secondary">
              {showFilters || currentQuery
                ? "No contacts match your filters."
                : "No contacts to show yet."}
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {rows.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/chat?contact=${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/chat?contact=${c.id}`);
                    }
                  }}
                  className={cn(
                    "grid items-center gap-3 px-4 py-3 cursor-pointer",
                    "transition-all duration-200 ease-out hover:bg-bg-tertiary/40 focus:outline-none focus-visible:bg-bg-tertiary/40",
                    pendingDelete.has(c.id) &&
                      "opacity-30 -translate-x-2 pointer-events-none",
                  )}
                  style={{
                    gridTemplateColumns: `40px 2fr 1.5fr 1.2fr 1fr${visibleDefs.map(() => " 1fr").join("")} 100px`,
                  }}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggleRow(c.id)}
                      aria-label={`Select ${displayContactName(c, "contact")}`}
                    />
                  </div>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="h-8 w-8 shrink-0">
                      {c.avatar_url ? <AvatarImage src={c.avatar_url} alt="" /> : null}
                      <AvatarFallback className="text-[11px] font-semibold bg-accent-muted text-accent">
                        {initialsFromContactName(c, c.email ?? c.phone ?? "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
                        <span className="truncate">{displayContactName(c, "") || (
                          <span className="italic text-text-tertiary">
                            Unnamed
                          </span>
                        )}</span>
                        <DndBadge dndEnabled={Boolean(c.dnd_enabled)} dndChannels={c.dnd_channels ?? []} />
                      </div>
                      {c.company && (
                        <div className="truncate text-[11.5px] text-text-tertiary">
                          {c.company}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="truncate text-[12.5px] text-text-secondary tabular-nums">
                    {c.phone ? (
                      <PhoneDisplay value={c.phone} stopPropagation className="text-text-secondary" />
                    ) : (
                      "-"
                    )}
                  </div>
                  <div
                    className={
                      "flex items-center gap-1 truncate text-[12.5px] " +
                      (c.email && !isValidEmail(c.email)
                        ? "text-amber-200"
                        : "text-text-secondary")
                    }
                    title={
                      c.email && !isValidEmail(c.email)
                        ? `Invalid email format: ${c.email}`
                        : undefined
                    }
                  >
                    {c.email && !isValidEmail(c.email) && (
                      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                    )}
                    <span className="truncate">{formatEmailDisplay(c.email) || "-"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 overflow-hidden">
                    {c.tags.slice(0, 2).map((tagName) => {
                      const tagObj = allTags.find(
                        (t) =>
                          t.name === tagName ||
                          t.slug === tagName.toLowerCase(),
                      );
                      return tagObj ? (
                        <span
                          key={tagName}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium"
                          style={{
                            backgroundColor: `${tagObj.color}22`,
                            borderColor: `${tagObj.color}44`,
                            color: tagObj.color,
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: tagObj.color }}
                          />
                          {tagName}
                        </span>
                      ) : (
                        <span
                          key={tagName}
                          className="inline-flex items-center rounded-full bg-accent-muted px-2 py-0.5 text-[10.5px] font-medium text-accent"
                        >
                          {tagName}
                        </span>
                      );
                    })}
                    {c.tags.length > 2 && (
                      <span className="text-[10.5px] text-text-tertiary">
                        +{c.tags.length - 2}
                      </span>
                    )}
                  </div>
                  {visibleDefs.map((def) => {
                    const cf = (c.custom_fields ?? {}) as Record<
                      string,
                      unknown
                    >;
                    const val = cf[def.key];
                    const config =
                      FIELD_RENDER_CONFIG[def.type as CustomFieldType];
                    const display =
                      val !== undefined && val !== null
                        ? config.displayFormatter(val)
                        : "-";
                    return (
                      <div
                        key={def.id}
                        className="truncate text-[12.5px] text-text-secondary"
                      >
                        {display}
                      </div>
                    );
                  })}
                  <div className="text-right text-[11.5px] text-text-tertiary">
                    {relativeTime(c.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination — numbered, bottom of the list */}
        {totalPages > 1 && (
          <PaginationControls
            page={page}
            totalPages={totalPages}
            total={total}
            onPage={(p) => setParam("page", String(p))}
            showNumbers
          />
        )}
      </div>

    </div>
  );
}

/**
 * Pagination controls shared by the contacts table (top + bottom bars).
 *
 * Layout: "Page X of Y · N total" sits on the left with the Previous/Next
 * buttons immediately to its right. When `showNumbers` is set, a numbered page
 * selector is rendered on the far side in windows of 10 (e.g. 1–10, then
 * 11–20, …) so large datasets stay navigable without an endless button row.
 */
function PaginationControls({
  page,
  totalPages,
  total,
  onPage,
  showNumbers = false,
  align = "between",
}: {
  page: number;
  totalPages: number;
  total?: number;
  onPage: (page: number) => void;
  showNumbers?: boolean;
  align?: "between" | "end";
}) {
  const WINDOW = 10;
  const windowStart = Math.floor((page - 1) / WINDOW) * WINDOW + 1;
  const windowEnd = Math.min(windowStart + WINDOW - 1, totalPages);
  const pageNumbers: number[] = [];
  for (let p = windowStart; p <= windowEnd; p++) pageNumbers.push(p);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3",
        align === "between" ? "justify-between" : "justify-end",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-text-tertiary whitespace-nowrap">
          Page {page} of {totalPages}
          {typeof total === "number" ? ` · ${total} total` : ""}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      {showNumbers && (
        <div className="flex flex-wrap items-center gap-1">
          {pageNumbers.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={p === page ? "secondary" : "ghost"}
              aria-current={p === page ? "page" : undefined}
              className="h-8 min-w-8 px-2 tabular-nums"
              onClick={() => onPage(p)}
            >
              {p}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactsFilterPopover({
  activeCount,
  allTags,
  currentTag,
  currentSource,
  filterableDefs,
  activeCfFilters,
  setParam,
  onClear,
}: {
  activeCount: number;
  allTags: TagRow[];
  currentTag?: string;
  currentSource?: string;
  filterableDefs: CustomFieldDefinitionRow[];
  activeCfFilters: Record<string, string>;
  setParam: (key: string, value: string | null) => void;
  onClear: () => void;
}) {
  return (
    <FilterPopover activeCount={activeCount} className="w-[360px]">
      <FilterPopoverHeader
        title="Contact filters"
        showClear={activeCount > 0}
        onClear={onClear}
      />
      <div className="space-y-4 p-4">
        <FilterSection title="Source">
          <FilterPill
            active={!currentSource}
            onClick={() => setParam("source", null)}
          >
            All sources
          </FilterPill>
          {CONTACT_SOURCES.map((source) => (
            <FilterPill
              key={source}
              active={currentSource === source}
              onClick={() => setParam("source", source)}
            >
              {sourceLabel(source)}
            </FilterPill>
          ))}
        </FilterSection>

        <FilterSection title="Tags">
          <TagChip
            label="All tags"
            active={!currentTag}
            onClick={() => setParam("tag", null)}
          />
          {allTags.length > 0 ? (
            allTags.map((tag) => (
              <TagChip
                key={tag.id}
                label={tag.name}
                color={tag.color}
                active={
                  currentTag === tag.id ||
                  currentTag === tag.name ||
                  currentTag === tag.slug
                }
                onClick={() =>
                  setParam(
                    "tag",
                    currentTag === tag.id ||
                      currentTag === tag.name ||
                      currentTag === tag.slug
                      ? null
                      : tag.id,
                  )
                }
              />
            ))
          ) : (
            <span className="text-xs text-text-tertiary">No tags yet</span>
          )}
        </FilterSection>

        {filterableDefs.length > 0 && (
          <div className="rounded-[8px] border border-border-subtle bg-bg-secondary/60 p-3">
            <CustomFieldsFilterBar
              filterableDefs={filterableDefs}
              activeFilters={activeCfFilters}
              onChange={(key, value) => setParam(`cff_${key}`, value)}
            />
          </div>
        )}
      </div>
    </FilterPopover>
  );
}

/**
 * Phase 110 CID-15: Conflicts filter chip rendered in the /contacts toolbar.
 *
 * Behaviour matrix:
 *   count = 0         → disabled visual (opacity-50, cursor-not-allowed,
 *                       pointer-events-none). Label "Conflicts: 0". No click.
 *   count > 0, !active → clickable, neutral styling. Click → adds filter.
 *   count > 0, active  → highlighted (accent), shows X. Click → clears filter.
 *
 * Renders as a button so keyboard focus + screen readers work the same as
 * the existing TagChip in the filter popover (visually similar primitive).
 */
function ConflictsChip({
  count,
  active,
  onToggle,
}: {
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  const disabled = count === 0;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      aria-pressed={active}
      aria-label={
        disabled
          ? "No conflicts to review"
          : active
            ? "Showing conflicts only — click to clear filter"
            : `Show ${count} contact${count === 1 ? "" : "s"} with conflicts`
      }
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors duration-150 whitespace-nowrap",
        disabled &&
          "opacity-50 cursor-not-allowed pointer-events-none border-border-subtle bg-bg-secondary text-text-tertiary",
        !disabled &&
          active &&
          "border-amber-500 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
        !disabled &&
          !active &&
          "border-border-subtle bg-bg-secondary text-text-secondary hover:border-border-strong hover:text-text-primary",
      )}
    >
      <span>Conflicts: {count}</span>
      {!disabled && active && <X className="h-3 w-3" />}
    </button>
  );
}

function TagChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active?: boolean;
  onClick: () => void;
}) {
  const style =
    active && color
      ? { backgroundColor: `${color}33`, borderColor: color, color }
      : color
        ? { backgroundColor: `${color}15`, borderColor: `${color}44`, color }
        : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors duration-150",
        !color &&
          (active
            ? "border-accent bg-accent text-accent-foreground"
            : "border-border-subtle bg-bg-secondary text-text-secondary hover:border-border-strong hover:text-text-primary"),
      )}
      style={style}
    >
      {color && (
        <span
          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      {active && label !== "All tags" && <X className="h-3 w-3" />}
    </button>
  );
}

function sourceLabel(s: string): string {
  switch (s) {
    case "manual":
      return "Manual";
    case "whatsapp":
      return "WhatsApp";
    case "sms":
      return "SMS";
    case "instagram":
      return "Instagram";
    case "csv_import":
      return "CSV import";
    case "ghl_sync":
      return "GHL sync";
    default:
      return s;
  }
}
