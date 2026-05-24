import { Suspense } from "react";

import { getContacts } from "./actions";
import { getDefinitions } from "@/app/(dashboard)/settings/custom-fields/actions";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { ContactsPageSkeleton } from "@/components/skeletons/contacts-page-skeleton";
import { CONTACT_SOURCES } from "@/lib/contacts/zod-schemas";

interface ContactsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ContactsPage({
  searchParams,
}: ContactsPageProps) {
  const sp = await searchParams;

  const q = typeof sp.q === "string" ? sp.q : undefined;
  const tag = typeof sp.tag === "string" ? sp.tag : undefined;
  const sourceRaw = typeof sp.source === "string" ? sp.source : undefined;
  const source =
    sourceRaw && (CONTACT_SOURCES as readonly string[]).includes(sourceRaw)
      ? (sourceRaw as (typeof CONTACT_SOURCES)[number])
      : undefined;
  const sort = typeof sp.sort === "string" ? sp.sort : undefined;
  const pageRaw = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // Extract custom field filters from cff_* URL params
  const cfFilters: Record<string, string> = {};
  for (const [key, val] of Object.entries(sp)) {
    if (key.startsWith("cff_") && typeof val === "string" && val) {
      cfFilters[key.slice(4)] = val;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Suspense fallback={<ContactsPageSkeleton rows={8} />}>
        <ContactsBody
          q={q}
          tag={tag}
          source={source}
          sort={sort}
          page={page}
          cfFilters={cfFilters}
        />
      </Suspense>
    </div>
  );
}

async function ContactsBody({
  q,
  tag,
  source,
  sort,
  page,
  cfFilters,
}: {
  q?: string;
  tag?: string;
  source?: (typeof CONTACT_SOURCES)[number];
  sort?: string;
  page: number;
  cfFilters: Record<string, string>;
}) {
  const [result, defsResult] = await Promise.all([
    getContacts({ q, tag, source, sort, page, pageSize: 25 }, cfFilters),
    getDefinitions({ entity: "contact", includeArchived: false }),
  ]);
  const defs = defsResult.ok ? defsResult.data : [];
  const visibleDefs = defs.filter((d) => d.visible_in_list);
  const filterableDefs = defs.filter((d) => d.filterable);

  return (
    <ContactsTable
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      allTags={result.allTags}
      currentTag={tag}
      currentSource={source}
      currentSort={sort ?? "recent"}
      currentQuery={q}
      visibleDefs={visibleDefs}
      filterableDefs={filterableDefs}
      activeCfFilters={cfFilters}
    />
  );
}
