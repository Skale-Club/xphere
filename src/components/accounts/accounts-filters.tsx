"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { X, MoreHorizontal, Download, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  FilterPill,
  FilterPopover,
  FilterPopoverHeader,
  FilterSection,
} from "@/components/data-table/filter-popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ACCOUNT_SIZES, ACCOUNT_SOURCES } from "@/lib/accounts";
import { exportAccountsCsv } from "@/app/(dashboard)/companies/actions";
import { NewCompanyDialog } from "./new-company-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountsFiltersProps {
  currentQuery?: string;
  currentIndustry?: string;
  currentSize?: string;
  currentTag?: string;
  currentAssignedTo?: string;
  currentSource?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INDUSTRY_OPTIONS = [
  "Technology",
  "Finance",
  "Healthcare",
  "Retail",
  "Manufacturing",
  "Education",
  "Real Estate",
  "Other",
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sourceLabel(s: string): string {
  switch (s) {
    case "manual":
      return "Manual";
    case "auto_from_contact_company":
      return "Auto-imported";
    case "csv_import":
      return "CSV import";
    case "ghl_sync":
      return "GHL sync";
    default:
      return s;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AccountsFilters({
  currentQuery,
  currentIndustry,
  currentSize,
  currentTag,
  currentAssignedTo,
  currentSource,
}: AccountsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Local state for debounced inputs
  const [query, setQuery] = React.useState(currentQuery ?? "");

  // Sync local state when URL params change (e.g., chip clear)
  React.useEffect(() => {
    setQuery(currentQuery ?? "");
  }, [currentQuery]);

  // ─── setParam helper ─────────────────────────────────────────────────────

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "page") params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  // ─── Debounced search → URL ───────────────────────────────────────────────

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

  // ─── Active filter chips ──────────────────────────────────────────────────

  const activeFilters = [
    { key: "q", label: `Search: "${currentQuery}"`, value: currentQuery },
    {
      key: "industry",
      label: `Industry: ${currentIndustry}`,
      value: currentIndustry,
    },
    { key: "size", label: `Size: ${currentSize}`, value: currentSize },
    { key: "tag", label: `Tag: ${currentTag}`, value: currentTag },
    {
      key: "assigned_to",
      label: `Owner: ${currentAssignedTo}`,
      value: currentAssignedTo,
    },
    {
      key: "source",
      label: `Source: ${sourceLabel(currentSource ?? "")}`,
      value: currentSource,
    },
  ].filter((f) => Boolean(f.value));
  const filterActiveCount = [
    currentIndustry,
    currentSize,
    currentSource,
  ].filter(Boolean).length;

  function clearUnifiedFilters() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("industry");
    params.delete("size");
    params.delete("source");
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("industry");
    params.delete("size");
    params.delete("tag");
    params.delete("assigned_to");
    params.delete("source");
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
    setQuery("");
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
      {/* Toolbar row */}
      <div className="animate-fade-in flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2">
        <NewCompanyDialog
          trigger={
            <Button size="sm" className="h-8">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Company</span>
            </Button>
          }
        />

        <SearchInput
          value={query}
          onValueChange={setQuery}
          onClear={() => setQuery("")}
          placeholder="Search name, domain, tag, owner..."
          containerClassName="max-w-[220px] sm:max-w-md"
        />

        <div className="hidden sm:block flex-1" />

        <div className="flex items-center gap-1.5 sm:gap-2">
          <AccountsFilterPopover
            activeCount={filterActiveCount}
            currentIndustry={currentIndustry}
            currentSize={currentSize}
            currentSource={currentSource}
            setParam={setParam}
            onClear={clearUnifiedFilters}
          />

          {/* More actions dropdown — all breakpoints */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="h-8 px-2.5">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <ExportMenuItem />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              onRemove={() => {
                setParam(f.key, null);
                if (f.key === "q") setQuery("");
              }}
            />
          ))}
          {activeFilters.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-6 px-2 text-[11px] text-text-tertiary hover:text-text-primary"
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ExportMenuItem ───────────────────────────────────────────────────────────

function ExportMenuItem() {
  const [exporting, setExporting] = React.useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await exportAccountsCsv();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (!res.csv) return;
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "companies.csv";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <DropdownMenuItem onClick={handleExport} disabled={exporting}>
      {exporting ? (
        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5 mr-2" />
      )}
      Export CSV
    </DropdownMenuItem>
  );
}

// ─── FilterChip ───────────────────────────────────────────────────────────────

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-secondary",
        "px-2.5 py-0.5 text-[11.5px] font-medium text-text-secondary",
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function AccountsFilterPopover({
  activeCount,
  currentIndustry,
  currentSize,
  currentSource,
  setParam,
  onClear,
}: {
  activeCount: number;
  currentIndustry?: string;
  currentSize?: string;
  currentSource?: string;
  setParam: (key: string, value: string | null) => void;
  onClear: () => void;
}) {
  return (
    <FilterPopover activeCount={activeCount}>
      <FilterPopoverHeader
        title="Company filters"
        showClear={activeCount > 0}
        onClear={onClear}
      />
      <div className="space-y-4 p-4">
        <FilterSection title="Industry">
          <FilterPill
            active={!currentIndustry}
            onClick={() => setParam("industry", null)}
          >
            All industries
          </FilterPill>
          {INDUSTRY_OPTIONS.map((industry) => (
            <FilterPill
              key={industry}
              active={currentIndustry === industry}
              onClick={() => setParam("industry", industry)}
            >
              {industry}
            </FilterPill>
          ))}
        </FilterSection>

        <FilterSection title="Size">
          <FilterPill
            active={!currentSize}
            onClick={() => setParam("size", null)}
          >
            All sizes
          </FilterPill>
          {ACCOUNT_SIZES.map((size) => (
            <FilterPill
              key={size}
              active={currentSize === size}
              onClick={() => setParam("size", size)}
            >
              {size}
            </FilterPill>
          ))}
        </FilterSection>

        <FilterSection title="Source">
          <FilterPill
            active={!currentSource}
            onClick={() => setParam("source", null)}
          >
            All sources
          </FilterPill>
          {ACCOUNT_SOURCES.map((source) => (
            <FilterPill
              key={source}
              active={currentSource === source}
              onClick={() => setParam("source", source)}
            >
              {sourceLabel(source)}
            </FilterPill>
          ))}
        </FilterSection>
      </div>
    </FilterPopover>
  );
}
