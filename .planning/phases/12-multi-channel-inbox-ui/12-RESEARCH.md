# Phase 12: Multi-Channel Inbox UI - Research

**Researched:** 2026-05-04
**Domain:** Next.js React UI — extending existing chat inbox components
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Three icons — Globe (widget), Instagram camera-style icon, Messenger lightning bolt icon. Implemented as inline SVGs in `src/components/chat/channel-icon.tsx`. Monochrome (currentColor).
- **D-02:** Icon appears at the START of each conversation row in ConversationList — 16x16px, before the conversation name/preview text.
- **D-03:** Existing widget conversations show Globe icon — no visual regression.
- **D-04:** Pills/tabs row rendered ABOVE the conversation list inside the inbox sidebar. Options: All / Website / Instagram / Messenger.
- **D-05:** Client-side filter — filter state lives in React state in ConversationList (or its parent). No server refetch. Filter by `conversation.channel` field.
- **D-06:** "All" is default/selected on load. Filter resets to "All" on page navigation.
- **D-07:** Active filter pill uses the primary color accent (existing Tailwind accent pattern).
- **D-08:** For Meta conversations, the header shows: [channel icon] [channel label] · [account name from meta_channels] · [bot status badge].
- **D-09:** Account name = `meta_channels.page_name` if available, else `meta_channels.page_id`. Fetched as part of the conversation data load (join or secondary query).
- **D-10:** Bot status badge: green "Bot active" or gray "Bot paused".
- **D-11:** Widget conversations show simplified header: [Globe icon] Website Chat · [bot status badge].
- **D-12:** Sticky banner rendered INSIDE ChatArea, ABOVE the message input field, BELOW the message list.
- **D-13:** Only visible when `conversation.channel_metadata?.window_expired === 'true'`.
- **D-14:** Visual: `bg-amber-50 border-amber-200 text-amber-800` (light mode), icon (⚠ or clock), text: "The 24-hour Meta messaging window has expired. Automated replies are paused."
- **D-15:** Not dismissible — state is server-driven.
- **D-16:** Pause/Resume button placed in the conversation header — icon button with tooltip ("Pause bot" / "Resume bot").
- **D-17:** Toggle via server action that updates `bot_status` ('active' → 'paused' → 'active').
- **D-18:** Button is present for ALL channels (widget + Meta).
- **D-19:** Optimistic UI update — toggle immediately in local state, confirm via server action. On error, revert with toast.

### Claude's Discretion

- Exact SVG paths for Instagram/Messenger icons — use recognizable approximations if official brand assets aren't available as open source
- Loading skeleton for channel filter bar if needed
- Exact Tailwind class names for the filter pills active/inactive states

### Deferred Ideas (OUT OF SCOPE)

- Channel-specific notification sounds
- Unread count per channel in filter pills
- WhatsApp channel icon/filter
- Read receipt indicators per channel
- Conversation search/filtering by keyword
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| METAINBOX-01 | Each conversation in the inbox shows a channel icon and name (website / Instagram / Messenger) | `ConversationList` currently maps over `ConversationSummary[]`; adding icon requires: (1) `channel` field added to `ConversationSummary`, (2) `ChannelIcon` component, (3) row layout change |
| METAINBOX-02 | Admin can filter inbox by channel (all / website / instagram / messenger) and by bot state (bot-active / bot-paused) | Client-side — filter pills above list; `ConversationList` already has tab-based filtering pattern (Open/Archived/All) to model from; bot-state filter requires `bot_status` field on `ConversationSummary` |
| METAINBOX-04 | Conversation header shows channel, connected account name, and current bot status | `ChatArea` header currently shows visitor name/email; needs `channel`, `channelAccountName` (from `meta_channels` join), and `botStatus` added to `ConversationSummary` |
| METAINBOX-05 | System shows a visual warning in conversations where the 24h Meta reply window has expired | `channel_metadata.window_expired === 'true'` already set by Phase 11; needs `channelMetadata` on `ConversationSummary` and banner UI in `ChatArea` |
| METAINBOX-06 | Admin can pause/resume bot per conversation across all channels (reuses existing `bot_status` field) | `bot_status` column does NOT yet exist in any migration or `database.ts` — Phase 12 must add migration + type; then wire toggle button + server action |
</phase_requirements>

---

## Summary

Phase 12 is a pure UI extension phase with one hidden schema dependency. All five METAINBOX requirements are UI-only work on top of existing data — except METAINBOX-06, which requires a new `bot_status` column on the `conversations` table. The column is referenced in planning documents as "existing" but is absent from every migration file and `database.ts`.

The core problem is a data shape gap: the existing `/api/chat/conversations` route fetches only 8 fields and maps them into `ConversationSummary`, which does not include `channel`, `channel_metadata`, `bot_status`, or `page_name` from `meta_channels`. All four must be added — either by extending the existing route's SELECT clause or by adding a secondary query for `meta_channels`. The client-side components (`ConversationList`, `ChatArea`) then consume the enriched type.

The component extension work follows well-established patterns: `ConversationList` already uses Tabs + client-side filter state; `ChatArea` already has a sticky header/send area split. Both components are `'use client'` and accept all data as props from `AdminChatLayout`.

**Primary recommendation:** Add migration 023 for `bot_status`, extend `/api/chat/conversations` SELECT + map, extend `ConversationSummary` type, then build UI features as additive changes to existing components.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19 (via Next.js 15) | Client component state and rendering | Project stack |
| shadcn/ui | Latest | Badge, Button, Tabs, Tooltip primitives | Already used in all chat components |
| Tailwind 4 | 4.x | Styling | Project stack |
| Lucide React | Latest | Icons (already imported in both chat components) | Project standard — Globe already available |
| sonner | Latest | Toast on bot-toggle error | Already used project-wide |
| zod | Latest | Request body validation in new API route | Already used in status route |

### Already Imported in Chat Components

`conversation-list.tsx` imports: `Search, Archive, ArchiveRestore, Trash2, Settings2` from lucide-react; `Badge, Button, Avatar, AvatarFallback, ScrollArea, Tabs, TabsList, TabsTrigger, AlertDialog*` from shadcn/ui.

`chat-area.tsx` imports: `MessageSquare, ArrowLeft, Send, Archive, ArchiveRestore, Trash2, MoreVertical` from lucide-react; `Button, Textarea, Avatar, AvatarFallback, ScrollArea, DropdownMenu*, AlertDialog*` from shadcn/ui.

**New imports needed:**
- `Tooltip, TooltipContent, TooltipProvider, TooltipTrigger` from shadcn/ui — for pause/resume button tooltip (D-16)
- `Pause, Play` (or `PauseCircle, PlayCircle`) from lucide-react — for pause/resume icon button
- `Globe` from lucide-react — already available, use for widget channel icon
- `toast` from `sonner` — for optimistic UI error rollback (D-19)

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline SVG for Instagram/Messenger | lucide-react icons | Lucide lacks brand-accurate Meta icons; inline SVG gives full shape control per D-01 |
| Extending existing `/api/chat/conversations` SELECT | New dedicated endpoint | Extending the existing route is simpler — same auth, same RLS, same poll loop |
| Secondary query for `meta_channels` | JOIN in conversations query | Supabase JS does not support arbitrary SQL JOINs via `.from()`; must use `.select('*, meta_channels(*)')` with a FK relationship, or a separate query. The conversations table does NOT have a FK to meta_channels — a separate query by `page_id` from `channel_metadata` is the correct approach |

---

## Architecture Patterns

### Recommended Project Structure

No new directories needed. All work lands in existing files plus two new files:

```
src/
  components/chat/
    channel-icon.tsx          ← NEW: ChannelIcon component (D-01)
    conversation-list.tsx     ← EXTEND: add channel icon + filter pills
    chat-area.tsx             ← EXTEND: add 24h banner + header enrichment + pause/resume button
    admin-chat-layout.tsx     ← EXTEND: add bot_status optimistic toggle handler
  app/
    (dashboard)/chat/
      actions.ts              ← EXTEND: add toggleBotStatus server action
    api/chat/conversations/
      route.ts                ← EXTEND: add channel, channel_metadata, bot_status to SELECT + map
  types/
    chat.ts                   ← EXTEND: add channel, channelMetadata, botStatus, channelAccountName to ConversationSummary
supabase/
  migrations/
    023_conversations_bot_status.sql  ← NEW: add bot_status column
```

### Pattern 1: Extending `ConversationSummary`

The central type that flows from the API route through `AdminChatLayout` into both child components.

**Current shape (src/types/chat.ts):**
```typescript
export interface ConversationSummary {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  lastMessageAt?: string | null
  visitorName?: string | null
  visitorEmail?: string | null
  visitorPhone?: string | null
  lastMessage?: string | null
}
```

**Required additions:**
```typescript
export interface ConversationSummary {
  // ... existing fields ...
  channel: string                           // 'widget' | 'messenger' | 'instagram'
  channelMetadata: Record<string, string>   // JSON from channel_metadata column
  botStatus: string                         // 'active' | 'paused' — from new bot_status column
  channelAccountName?: string | null        // page_name from meta_channels (resolved server-side)
}
```

### Pattern 2: Extending the Conversations API Route

`/api/chat/conversations/route.ts` currently SELECTs 8 columns and maps them. The SELECT must be extended and `channelAccountName` must be resolved via a secondary query.

**Why secondary query for page_name:**
The `conversations` table has no FK to `meta_channels`. The link is through `channel_metadata->>'page_id'` (a JSONB text value). Supabase's `.select()` only supports FK-based joins. Resolution options:
1. In-process secondary query: for each unique `page_id` in the fetched conversations, query `meta_channels` once, then map by `page_id`.
2. SQL RPC: a custom PostgreSQL function returning enriched rows.

Option 1 (secondary query) is consistent with the project's server action patterns and avoids adding a new RPC. Since all conversations are fetched in one poll (no pagination), the set of unique `page_id` values is bounded.

**Extended SELECT:**
```typescript
.select('id, status, created_at, updated_at, last_message_at, visitor_name, visitor_email, visitor_phone, last_message, channel, channel_metadata, bot_status')
```

**Secondary query for account names:**
```typescript
// Collect unique page_ids from Meta conversations
const pageIds = [...new Set(
  data
    .filter(r => r.channel !== 'widget')
    .map(r => (r.channel_metadata as Record<string, string>)?.page_id)
    .filter(Boolean)
)]

// Fetch page_names in one query if any Meta conversations exist
let pageNameMap: Record<string, string> = {}
if (pageIds.length > 0) {
  const { data: channels } = await supabase
    .from('meta_channels')
    .select('page_id, page_name')
    .in('page_id', pageIds)
  for (const ch of channels ?? []) {
    pageNameMap[ch.page_id] = ch.page_name ?? ch.page_id
  }
}
```

### Pattern 3: Bot Status Migration

`bot_status` must be added to `conversations` before the UI can read or write it. Pattern follows migration 020/022:

```sql
-- Migration 023: add bot_status to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS bot_status
    TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT conversations_bot_status_check
    CHECK (bot_status IN ('active', 'paused'));
```

`database.ts` Row must add `bot_status: string`. Update must add `bot_status?: string`.

### Pattern 4: Server Action for Bot Toggle

Follows the existing status route pattern (`/api/chat/conversations/[id]/status/route.ts`):

```typescript
// src/app/(dashboard)/chat/actions.ts — add server action
'use server'
export async function toggleBotStatus(
  conversationId: string,
  currentStatus: string
): Promise<{ botStatus: string } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const newStatus = currentStatus === 'active' ? 'paused' : 'active'
  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ bot_status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to update bot status' }
  return { botStatus: newStatus }
}
```

### Pattern 5: Optimistic Bot Toggle in AdminChatLayout

`AdminChatLayout` owns `conversations` state. The optimistic update pattern is already used for `handleSendMessage`:

```typescript
// Optimistic update pattern — consistent with existing handleSendMessage
async function handleBotStatusToggle(conversationId: string, currentStatus: string) {
  const optimisticStatus = currentStatus === 'active' ? 'paused' : 'active'
  // Immediately update local state
  setConversations(prev =>
    prev.map(c => c.id === conversationId ? { ...c, botStatus: optimisticStatus } : c)
  )
  const result = await toggleBotStatus(conversationId, currentStatus)
  if ('error' in result) {
    // Revert on error
    setConversations(prev =>
      prev.map(c => c.id === conversationId ? { ...c, botStatus: currentStatus } : c)
    )
    toast.error('Failed to update bot status')
  }
}
```

### Pattern 6: ChannelIcon Component

```typescript
// src/components/chat/channel-icon.tsx
type ChannelIconProps = { channel: string; className?: string }

export function ChannelIcon({ channel, className = 'h-4 w-4' }: ChannelIconProps) {
  if (channel === 'instagram') return <InstagramIcon className={className} />
  if (channel === 'messenger') return <MessengerIcon className={className} />
  return <GlobeIcon className={className} /> // widget + default
}

// Globe: use lucide-react Globe (already available project-wide)
// Instagram/Messenger: inline SVG with currentColor, recognizable brand shape
```

### Pattern 7: 24h Warning Banner Placement

`ChatArea` structure (flex column, top-to-bottom):
1. Header div (shrink-0)
2. ScrollArea messages (flex-1)
3. **Banner** (shrink-0, conditional) ← INSERT HERE
4. Send form div (shrink-0)

The banner div sits between the ScrollArea and the send form. It reads `conversation.channelMetadata?.window_expired === 'true'`.

### Pattern 8: Channel Filter Pills

`ConversationList` has an existing Tabs block (Open/Archived/All) in the sidebar. Channel filter is a SEPARATE second filter row below the status tabs. Use the same Tabs/TabsList/TabsTrigger pattern or simple Button pills.

The filter lives in `ConversationList` local state (`useState<'all' | 'widget' | 'instagram' | 'messenger'>`). The existing `filtered` derivation adds a channel filter step:

```typescript
// Add to existing filter chain
if (channelFilter !== 'all' && c.channel !== channelFilter) return false
```

METAINBOX-02 also requires bot-state filter (bot-active / bot-paused). This is a second independent filter dimension alongside channel. Both live in local state.

### Anti-Patterns to Avoid

- **Do not refetch on filter change:** All conversations are already in memory. D-05 is explicit — no server refetch on filter.
- **Do not add `page_name` as a direct FK join on conversations:** The table has no FK relationship to `meta_channels`. A secondary query by `page_id` values is the correct path.
- **Do not skip the migration for `bot_status`:** The column is referenced as "existing" in CONTEXT.md but is genuinely absent from all migrations and `database.ts`. Phase 12 Wave 0 must add migration 023 before any bot-status UI work can compile or run.
- **Do not use `'use server'` at the component level for the toggle:** Follow the existing pattern — server action in `actions.ts`, called from `AdminChatLayout` via `handleBotStatusToggle`, prop-drilled to `ChatArea`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip on pause/resume button | Custom hover div | shadcn/ui `Tooltip` + `TooltipProvider` | Accessible, already in project, handles keyboard |
| Toast on toggle error | Custom notification state | `sonner` `toast.error()` | Already project-standard |
| Icon primitives | Custom SVG wrapper component | lucide-react `Globe` for widget; custom SVG component for Instagram/Messenger | Lucide has Globe; Meta brand icons are not in Lucide |
| Status badge | Custom styled span | shadcn/ui `Badge` with variant | Already imported in `ConversationList` |

---

## Critical Finding: `bot_status` Column Does Not Exist

**This is the most important research finding.**

`bot_status` is referenced as an "existing field" in CONTEXT.md (D-17, D-18), STATE.md, and REQUIREMENTS.md (METAINBOX-06). However, code inspection reveals:

- No migration file contains `bot_status`
- `database.ts` `conversations.Row` does not have `bot_status`
- No source file in `src/` references `bot_status`
- Migration 015 (`015_conversations.sql`) — cited in 11-CONTEXT.md as the source — does NOT contain `bot_status`

**Action required:** Phase 12 Wave 0 must include migration 023 adding `bot_status TEXT NOT NULL DEFAULT 'active'` to the `conversations` table, along with updating `database.ts`.

Without this migration, the bot pause/resume toggle (METAINBOX-06) cannot be implemented.

---

## Critical Finding: `ConversationSummary` Lacks All New Fields

The existing `/api/chat/conversations` route SELECTs only: `id, status, created_at, updated_at, last_message_at, visitor_name, visitor_email, visitor_phone, last_message`.

`channel`, `channel_metadata`, and `bot_status` are NOT fetched. `channelAccountName` is NOT resolved.

All four must be added before any UI feature can function:
1. Extend SELECT clause in route.ts
2. Add secondary `meta_channels` query for `page_name`
3. Extend `ConversationSummary` interface in `chat.ts`
4. Update the map function in route.ts

---

## Common Pitfalls

### Pitfall 1: Assuming `bot_status` Exists
**What goes wrong:** Writing UI code against `conversation.botStatus` before migration 023 runs; TypeScript build passes if type is added first but DB write fails at runtime.
**Why it happens:** CONTEXT.md references it as existing; the actual migration was never written.
**How to avoid:** Wave 0 must add migration 023 AND update `database.ts` before any other work. Verify with `npm run build` after migration.
**Warning signs:** `column "bot_status" does not exist` Postgres error at runtime.

### Pitfall 2: Forgetting `page_name` Requires a Secondary Query
**What goes wrong:** Trying to join `meta_channels` via Supabase's `.select('*, meta_channels(*)')` — this requires a FK relationship that does not exist on `conversations`.
**Why it happens:** The join-like syntax suggests it should work; but the link is through a JSONB field (`channel_metadata->>'page_id'`), not a FK column.
**How to avoid:** Use the secondary query pattern: collect unique `page_id` values from fetched conversations, query `meta_channels` with `.in('page_id', pageIds)`, build a map.
**Warning signs:** Supabase returns an error about no relationship between `conversations` and `meta_channels`.

### Pitfall 3: Bot Status Filter Breaking When `botStatus` Is Undefined
**What goes wrong:** The bot-state filter (`bot-active` / `bot-paused`) evaluates `c.botStatus === 'active'` — if any conversation has an undefined `botStatus` (e.g., the migration wasn't applied yet in development), the filter produces wrong results silently.
**How to avoid:** Default `botStatus` to `'active'` in the map function to match the DB default.

### Pitfall 4: Channel Filter Hiding Widget Conversations for Existing Users
**What goes wrong:** Existing widget conversations have `channel = 'widget'` (set by migration 020 DEFAULT). The filter tab label "Website" must map to `channel === 'widget'`, not `channel === 'website'`.
**How to avoid:** The filter mapping must be `'Website' → channel === 'widget'` (not `'website'`). Use the DB enum value `'widget'` as the filter key.

### Pitfall 5: `window_expired` Flag Not Cleared After New Inbound
**What goes wrong:** The banner persists after a new inbound message resets the window, because `channel_metadata` is stale in the polled data.
**Why it happens:** Phase 11 sets `window_expired: 'true'` when the window expires but a new inbound message should reset it. Looking at `process-event.ts`: when `windowExpired` is true, it sets `window_expired: 'true'` in metadata. When a new message arrives on a non-expired conversation, `last_inbound_at` is updated but `window_expired` is NOT explicitly cleared.
**How to avoid:** Phase 12 UI can only display what the DB has. The banner disappearing is Phase 11's responsibility (clear `window_expired` on next valid inbound). If Phase 11 does not clear the flag, the banner will persist. This is a cross-phase dependency to note for the plan.

### Pitfall 6: Optimistic Toggle Race Condition
**What goes wrong:** Admin double-clicks pause/resume; second toggle fires before first server action completes; state reverts incorrectly.
**How to avoid:** Disable the button while the server action is in flight. Track loading state per-conversation-id in `AdminChatLayout`, pass as prop.

---

## Code Examples

### Verified: Existing Filter Pattern in ConversationList
```typescript
// Source: src/components/chat/conversation-list.tsx (lines 49-64)
const filtered = conversations.filter((c) => {
  if (activeTab === 'open' && c.status !== 'open') return false
  if (activeTab === 'archived' && c.status !== 'closed') return false
  if (search.trim()) {
    const q = search.toLowerCase()
    // ... search logic
    if (!name.includes(q) && !email.includes(q) && !msg.includes(q)) return false
  }
  return true
})
```

Adding channel + bot-state filter follows this exact same chain of early-return guards.

### Verified: Existing Tabs Pattern in ConversationList
```typescript
// Source: src/components/chat/conversation-list.tsx (lines 128-137)
<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
  <TabsList className="w-full h-9 grid grid-cols-3 bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl p-1 shadow-inner">
    <TabsTrigger value="open" className="text-xs rounded-lg data-[state=active]:bg-white ...">Open</TabsTrigger>
    // ...
  </TabsList>
</Tabs>
```

Channel filter pills use the same `Tabs` + `TabsList` + `TabsTrigger` pattern. Four options (All / Website / Instagram / Messenger) → `grid-cols-4`.

### Verified: Status Toggle API Route Pattern
```typescript
// Source: src/app/api/chat/conversations/[id]/status/route.ts
const { error } = await supabase
  .from('conversations')
  .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
  .eq('id', id)
```

Bot status toggle follows identical pattern: replace `status` with `bot_status`, adjust enum values.

### Verified: Header Structure in ChatArea
```typescript
// Source: src/components/chat/chat-area.tsx (lines 124-156)
<div className="flex items-center justify-between px-6 py-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10 shrink-0">
  <div className="flex items-center gap-4">
    {/* mobile back, avatar, name/email */}
  </div>
  <div className="flex items-center gap-3 z-20 shrink-0">
    {/* debug toggle, dropdown menu */}
  </div>
</div>
```

Channel icon + label + account name replace or augment the name/email section. Pause/resume button goes into the right-side actions `div` alongside the debug toggle.

### Verified: Secondary Query Pattern (from process-event.ts)
```typescript
// Source: src/lib/meta/process-event.ts (lines 45-57)
const { data: metaChannel } = await supabase
  .from('meta_channels')
  .select('org_id, automation_id, config')
  .eq('page_id', pageId)
  .eq('channel_type', channelType)
  .eq('is_active', true)
  .maybeSingle()
```

The `meta_channels` table is queryable by `page_id`. For the conversations API route, use `.in('page_id', pageIds)` to batch-resolve page names.

### Verified: `window_expired` Flag Location
```typescript
// Source: src/lib/meta/process-event.ts (lines 134-144)
if (windowExpired) {
  await supabase
    .from('conversations')
    .update({
      last_inbound_at: now,
      channel_metadata: { ...existingChannelMetadata, window_expired: 'true' },
    })
    .eq('id', conversationId)
  continue
}
```

The flag is `channel_metadata.window_expired === 'true'` (string, not boolean). The UI banner condition must compare to the string `'true'`, not the boolean `true`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-channel inbox (widget only) | Multi-channel inbox with type discrimination | v1.3 (Phase 12) | Requires channel field in all data-flow layers |
| No bot toggle in inbox | bot_status per conversation | v1.3 (Phase 12) | Requires new DB column |

---

## Open Questions

1. **Does `process-event.ts` clear `window_expired` when a new valid inbound arrives?**
   - What we know: Phase 11 sets `window_expired: 'true'` when expired. When a new message arrives on a non-expired conversation, it updates `last_inbound_at` but does not explicitly set `window_expired: 'false'`.
   - What's unclear: If a user messages again after the window resets (window no longer expired), does the flag get cleared?
   - Recommendation: The planner should include a task to verify and fix this in `process-event.ts` if needed, or note it as a known limitation. The UI banner is server-driven and will persist if the flag is never cleared.

2. **Should `channelAccountName` be resolved per-org for security?**
   - What we know: The conversations API route uses the authenticated Supabase client, which enforces RLS (`org_id = get_current_org_id()`). The secondary `meta_channels` query also uses this client, so RLS scopes it to the active org automatically.
   - Recommendation: No extra org filter needed — RLS covers it.

---

## Environment Availability

Step 2.6: SKIPPED — this is a code/UI-only phase with no new external service dependencies. All dependencies (Supabase, Next.js, shadcn/ui) are already operational.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run tests/` |
| Full suite command | `npx vitest run && npm run build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| METAINBOX-01 | ChannelIcon renders correct icon per channel | unit | `npx vitest run tests/channel-icon.test.tsx` | ❌ Wave 0 |
| METAINBOX-02 | ConversationList filters by channel and bot state | unit | `npx vitest run tests/conversation-list-filter.test.tsx` | ❌ Wave 0 |
| METAINBOX-04 | ChatArea header shows correct channel info | unit | `npx vitest run tests/chat-area-header.test.tsx` | ❌ Wave 0 |
| METAINBOX-05 | 24h banner visible when window_expired=true, hidden otherwise | unit | `npx vitest run tests/chat-area-banner.test.tsx` | ❌ Wave 0 |
| METAINBOX-06 | toggleBotStatus server action updates bot_status correctly | unit | `npx vitest run tests/bot-status-toggle.test.ts` | ❌ Wave 0 |

Note: UI component tests use `tests/**/*.test.tsx` (Vitest with react plugin configured in `vitest.config.ts`). The existing `meta-settings.test.tsx` confirms React component testing is working.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/`
- **Per wave merge:** `npx vitest run && npm run build`
- **Phase gate:** Full suite green + `npm run build` passes before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/channel-icon.test.tsx` — covers METAINBOX-01
- [ ] `tests/conversation-list-filter.test.tsx` — covers METAINBOX-02
- [ ] `tests/chat-area-header.test.tsx` — covers METAINBOX-04
- [ ] `tests/chat-area-banner.test.tsx` — covers METAINBOX-05
- [ ] `tests/bot-status-toggle.test.ts` — covers METAINBOX-06
- [ ] `supabase/migrations/023_conversations_bot_status.sql` — migration for `bot_status` column (blocking dependency for METAINBOX-06)

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/components/chat/conversation-list.tsx` — exact props, state, filter logic, and shadcn imports
- Direct code inspection: `src/components/chat/chat-area.tsx` — exact layout structure and shadcn imports
- Direct code inspection: `src/components/chat/admin-chat-layout.tsx` — data flow, poll loop, optimistic patterns
- Direct code inspection: `src/app/api/chat/conversations/route.ts` — exact SELECT clause confirming channel/bot_status absence
- Direct code inspection: `src/types/chat.ts` — confirmed `ConversationSummary` lacks channel/bot_status fields
- Direct code inspection: `src/types/database.ts` — confirmed `bot_status` absent from conversations Row type
- Migration audit: `015_conversations.sql`, `020_conversations_channel.sql`, `022_conversation_inbound_at.sql` — confirmed no `bot_status` column anywhere
- Direct code inspection: `src/lib/meta/process-event.ts` — confirmed `window_expired: 'true'` string flag pattern and page_id join path
- Direct code inspection: `src/app/api/chat/conversations/[id]/status/route.ts` — bot toggle server action pattern

### Secondary (MEDIUM confidence)
- Planning docs: `12-CONTEXT.md` — locked decisions used as-is
- Planning docs: `STATE.md`, `REQUIREMENTS.md` — requirement IDs and cross-phase context

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use, inspected from imports
- Architecture: HIGH — based on direct code inspection of all relevant files
- Pitfalls: HIGH — bot_status absence verified by exhaustive migration and source file audit
- `window_expired` clear behavior: MEDIUM — code shows it's set but not explicitly cleared on valid inbound

**Research date:** 2026-05-04
**Valid until:** Stable — no fast-moving external dependencies; valid until Phase 13 or schema changes
