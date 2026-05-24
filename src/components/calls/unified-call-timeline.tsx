"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Mic,
  Clock,
  PhoneOff,
  Bot,
  User as UserIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  FilterPill,
  FilterPopover,
  FilterPopoverHeader,
  FilterSection,
} from "@/components/data-table/filter-popover";
import { cn } from "@/lib/utils";
import type { UnifiedCallWithContact } from "@/app/(dashboard)/calls/actions";

type TypeFilter = "all" | "ai" | "human";
type DirectionFilter = "all" | "inbound" | "outbound" | "missed";

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ai", label: "AI" },
  { id: "human", label: "Human" },
];

const DIR_FILTERS: Array<{ id: DirectionFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "inbound", label: "Inbound" },
  { id: "outbound", label: "Outbound" },
  { id: "missed", label: "Missed" },
];

interface UnifiedCallTimelineProps {
  rows: UnifiedCallWithContact[];
  total: number;
  page: number;
  pageSize: number;
  currentType: TypeFilter;
  currentDirection: DirectionFilter;
  currentQuery?: string;
}

export function UnifiedCallTimeline({
  rows,
  total,
  page,
  pageSize,
  currentType,
  currentDirection,
  currentQuery,
}: UnifiedCallTimelineProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [query, setQuery] = React.useState(currentQuery ?? "");

  React.useEffect(() => {
    if ((currentQuery ?? "") === query) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(Array.from(sp.entries()));
      if (query) params.set("q", query);
      else params.delete("q");
      params.delete("page");
      router.replace(
        `${pathname}${params.toString() ? `?${params.toString()}` : ""}`,
      );
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(Array.from(sp.entries()));
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.replace(
      `${pathname}${params.toString() ? `?${params.toString()}` : ""}`,
    );
  }

  const groups = React.useMemo(() => groupByDay(rows), [rows]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilterCount =
    (currentType !== "all" ? 1 : 0) + (currentDirection !== "all" ? 1 : 0);

  function clearFilters() {
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.delete("type");
    params.delete("direction");
    params.delete("page");
    router.replace(
      `${pathname}${params.toString() ? `?${params.toString()}` : ""}`,
    );
  }

  return (
    <div className="-mt-6 space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          onClear={() => setQuery("")}
          placeholder="Search number, name, notes..."
          containerClassName="min-w-0 flex-1 max-w-none sm:max-w-md"
        />

        <FilterPopover activeCount={activeFilterCount}>
          <FilterPopoverHeader
            title="Filters"
            showClear={activeFilterCount > 0}
            onClear={clearFilters}
          />
          <div className="space-y-5 p-4">
            <FilterSection title="Type">
              {TYPE_FILTERS.map((filter) => (
                <FilterPill
                  key={filter.id}
                  active={currentType === filter.id}
                  onClick={() =>
                    setParam("type", filter.id === "all" ? null : filter.id)
                  }
                >
                  {filter.label}
                </FilterPill>
              ))}
            </FilterSection>
            <FilterSection title="Direction">
              {DIR_FILTERS.map((filter) => (
                <FilterPill
                  key={filter.id}
                  active={currentDirection === filter.id}
                  onClick={() =>
                    setParam(
                      "direction",
                      filter.id === "all" ? null : filter.id,
                    )
                  }
                >
                  {filter.label}
                </FilterPill>
              ))}
            </FilterSection>
          </div>
        </FilterPopover>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <EmptyTimeline />
      ) : (
        <div className="space-y-7">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                {group.label}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.rows.map((row) => (
                  <UnifiedCallRow
                    key={`${row.call_type}-${row.id}`}
                    row={row}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-[12px] text-text-tertiary">
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setParam("page", String(page - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages}
              onClick={() => setParam("page", String(page + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UnifiedCallRow({ row }: { row: UnifiedCallWithContact }) {
  const isMissed =
    row.direction === "inbound" &&
    ["no-answer", "busy", "failed", "canceled"].includes(row.status ?? "");
  const Icon = isMissed
    ? PhoneMissed
    : row.direction === "inbound"
      ? PhoneIncoming
      : PhoneOutgoing;

  const displayName =
    row.contact?.name ??
    row.counterpart_name ??
    row.counterpart_number ??
    "Unknown";

  return (
    <Link
      href={`/calls/${row.id}`}
      className="group flex items-center gap-3 rounded-[12px] border border-border bg-bg-secondary px-3.5 py-3 transition-colors hover:border-border-strong hover:bg-bg-tertiary/40"
    >
      <Avatar className="h-9 w-9">
        <AvatarFallback className="bg-bg-tertiary text-[12px] font-medium text-text-secondary">
          {initialsOf(displayName)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-text-primary">
            {displayName}
          </span>
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              isMissed
                ? "text-rose-400"
                : row.direction === "inbound"
                  ? "text-emerald-400"
                  : "text-accent",
            )}
          />
          <TypeBadge type={row.call_type} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-text-tertiary">
          <span className="truncate">{row.counterpart_number ?? "|"}</span>
          {row.routing_mode && (
            <>
              <span>·</span>
              <span className="capitalize">
                {routingLabel(row.routing_mode)}
              </span>
            </>
          )}
          {row.call_type === "ai" &&
            row.cost != null &&
            Number(row.cost) > 0 && (
              <>
                <span>·</span>
                <span>${Number(row.cost).toFixed(3)}</span>
              </>
            )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {row.recording_url && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted/30 px-2 py-0.5 text-[10.5px] font-medium text-accent">
            <Mic className="h-3 w-3" />
            Recorded
          </span>
        )}
        {row.call_type === "ai" && row.transcript && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10.5px] font-medium text-violet-300">
            Transcript
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[11.5px] text-text-tertiary">
          <Clock className="h-3 w-3" />
          {formatDuration(row.duration_seconds)}
        </span>
        <StatusPill status={row.status ?? null} />
      </div>
    </Link>
  );
}

function TypeBadge({ type }: { type: "ai" | "human" }) {
  if (type === "ai") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-0 text-[10px] font-medium text-violet-300">
        <Bot className="h-2.5 w-2.5" />
        AI
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-bg-tertiary px-1.5 py-0 text-[10px] font-medium text-text-tertiary">
      <UserIcon className="h-2.5 w-2.5" />
      Human
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<
    string,
    { label: string; tone: "success" | "warn" | "danger" | "muted" }
  > = {
    completed: { label: "Completed", tone: "success" },
    ended: { label: "Ended", tone: "success" },
    "in-progress": { label: "In progress", tone: "warn" },
    ringing: { label: "Ringing", tone: "warn" },
    initiated: { label: "Initiated", tone: "muted" },
    queued: { label: "Queued", tone: "muted" },
    "no-answer": { label: "No answer", tone: "danger" },
    busy: { label: "Busy", tone: "danger" },
    failed: { label: "Failed", tone: "danger" },
    canceled: { label: "Canceled", tone: "danger" },
  };
  const meta = map[status] ?? { label: status, tone: "muted" as const };
  const tones: Record<string, string> = {
    success: "bg-emerald-500/15 text-emerald-300",
    warn: "bg-amber-400/15 text-amber-300",
    danger: "bg-rose-500/15 text-rose-300",
    muted: "bg-bg-tertiary text-text-tertiary",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
        tones[meta.tone],
      )}
    >
      {meta.label}
    </span>
  );
}

function EmptyTimeline() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-border bg-bg-secondary py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-tertiary text-text-tertiary">
        <PhoneOff className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-[14px] font-medium text-text-primary">
          No calls yet
        </h3>
        <p className="mt-1 max-w-sm text-[12.5px] text-text-secondary">
          Connect a Twilio number or Vapi assistant to start receiving calls.
        </p>
      </div>
    </div>
  );
}

function initialsOf(name: string | null | undefined): string {
  const base = (name ?? "?").replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "|";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function routingLabel(mode: string): string {
  if (mode === "phone_forward") return "Forward";
  if (mode === "sip") return "SIP";
  if (mode === "browser") return "Browser";
  return mode;
}

function groupByDay(rows: UnifiedCallWithContact[]) {
  const groups = new Map<string, UnifiedCallWithContact[]>();
  const now = new Date();
  const todayKey = startOfDay(now).toISOString();
  const yKey = startOfDay(new Date(now.getTime() - 86400000)).toISOString();

  for (const row of rows) {
    const ts = row.started_at ?? row.created_at;
    if (!ts) continue;
    const dayKey = startOfDay(new Date(ts)).toISOString();
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    groups.get(dayKey)!.push(row);
  }

  return Array.from(groups.entries()).map(([key, rows]) => {
    let label = new Date(key).toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    if (key === todayKey) label = "Today";
    else if (key === yKey) label = "Yesterday";
    return { key, label, rows };
  });
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
