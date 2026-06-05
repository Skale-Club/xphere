import { Suspense } from "react";

import { getContacts } from "./actions";
import { getDefinitions } from "@/app/(dashboard)/settings/custom-fields/actions";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { EntityPageTemplate } from "@/components/crm/entity-template";
import { ContactsPageSkeleton } from "@/components/skeletons/contacts-page-skeleton";
import {
  CONTACT_SOURCES,
  CONTACT_CHANNEL_FILTERS,
  type ContactChannelFilter,
} from "@/lib/contacts/zod-schemas";
import { getConflictCount } from "@/lib/contacts/server";
import { createClient } from "@/lib/supabase/server";

const VALID_IDENTITY_STATUS = [
  "channel_only",
  "identified",
  "verified",
  "merge_conflict",
] as const;
type IdentityStatusFilter = (typeof VALID_IDENTITY_STATUS)[number];

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
  const channelRaw = typeof sp.channel === "string" ? sp.channel : undefined;
  const channel = (CONTACT_CHANNEL_FILTERS as readonly string[]).includes(
    channelRaw ?? "",
  )
    ? (channelRaw as ContactChannelFilter)
    : undefined;
  const sort = typeof sp.sort === "string" ? sp.sort : undefined;
  const pageRaw = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // Phase 110 CID-15 / D-08: conflict filter URL param. Single canonical key
  // `identity_status` (Pitfall 5 — no separate `?conflicts=1` flag).
  const identityStatusRaw =
    typeof sp.identity_status === "string" ? sp.identity_status : undefined;
  const identityStatus = (
    VALID_IDENTITY_STATUS as readonly string[]
  ).includes(identityStatusRaw ?? "")
    ? (identityStatusRaw as IdentityStatusFilter)
    : undefined;

  // Extract custom field filters from cff_* URL params
  const cfFilters: Record<string, string> = {};
  for (const [key, val] of Object.entries(sp)) {
    if (key.startsWith("cff_") && typeof val === "string" && val) {
      cfFilters[key.slice(4)] = val;
    }
  }

  return (
    <EntityPageTemplate
      scope={{ entity: "contact", lifecycleStage: "all", excludeLifecycleStages: ["prospect"] }}
    >
      <Suspense fallback={<ContactsPageSkeleton rows={8} />}>
        <ContactsBody
          q={q}
          tag={tag}
          source={source}
          channel={channel}
          sort={sort}
          page={page}
          cfFilters={cfFilters}
          identityStatus={identityStatus}
        />
      </Suspense>
    </EntityPageTemplate>
  );
}

async function ContactsBody({
  q,
  tag,
  source,
  channel,
  sort,
  page,
  cfFilters,
  identityStatus,
}: {
  q?: string;
  tag?: string;
  source?: (typeof CONTACT_SOURCES)[number];
  channel?: ContactChannelFilter;
  sort?: string;
  page: number;
  cfFilters: Record<string, string>;
  identityStatus?: IdentityStatusFilter;
}) {
  const supabase = await createClient();
  const [result, defsResult, conflictCount] = await Promise.all([
    getContacts(
      {
        q,
        tag,
        source,
        channel,
        sort,
        page,
        pageSize: 25,
        identity_status: identityStatus,
      },
      cfFilters,
    ),
    getDefinitions({ entity: "contact", includeArchived: false }),
    getConflictCount(supabase),
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
      currentChannel={channel}
      currentQuery={q}
      visibleDefs={visibleDefs}
      filterableDefs={filterableDefs}
      activeCfFilters={cfFilters}
      conflictCount={conflictCount}
      currentIdentityStatus={identityStatus}
    />
  );
}
