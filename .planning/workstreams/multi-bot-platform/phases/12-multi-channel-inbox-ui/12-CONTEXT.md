# Phase 12: Multi-Channel Inbox UI - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Mode:** auto

<domain>
## Phase Boundary

Extend the existing chat inbox UI to display channel identity on every conversation (icon + label), add a client-side channel filter bar, enrich the conversation header for Meta channels (account name, bot status), show a 24h window expiry warning banner inside the chat area, and wire pause/resume bot controls. No new data fetching endpoints — all data is already available via existing queries; this phase is purely UI work on top of Phase 11's schema and Phase 10's meta_channels data.

Does NOT include:
- Outbound reply routing (Phase 13)
- Any new API routes or server actions beyond what's needed to toggle bot_status
- WhatsApp or other channels

</domain>

<decisions>
## Implementation Decisions

### Channel Icons
- **D-01:** Three icons — Globe (widget), Instagram camera-style icon, Messenger lightning bolt icon. Implemented as inline SVG components in `src/components/chat/channel-icon.tsx`. Use brand-accurate shapes but monochrome (currentColor) so they respect dark/light mode.
- **D-02:** Icon appears at the START of each conversation row in ConversationList — 16x16px, before the conversation name/preview text.
- **D-03:** Existing widget conversations show Globe icon — no visual regression, their appearance is extended not changed.

### Channel Filter Bar
- **D-04:** Pills/tabs row rendered ABOVE the conversation list inside the inbox sidebar. Options: All / Website / Instagram / Messenger.
- **D-05:** Client-side filter — filter state lives in React state in ConversationList (or its parent). No server refetch. Conversations are filtered by `conversation.channel` field already present in the fetched data.
- **D-06:** "All" is default/selected on load. Filter resets to "All" on page navigation.
- **D-07:** Active filter pill uses the primary color accent (existing Tailwind accent pattern).

### Conversation Header
- **D-08:** For Meta conversations, the header shows: [channel icon] [channel label] · [account name from meta_channels] · [bot status badge].
- **D-09:** Account name = `meta_channels.page_name` if available, else `meta_channels.page_id`. Fetched as part of the conversation data load (join or secondary query).
- **D-10:** Bot status badge: green "Bot active" or gray "Bot paused" — matches existing bot_status field on conversations.
- **D-11:** Widget conversations show simplified header: [Globe icon] Website Chat · [bot status badge]. Same layout, simpler content.

### 24h Warning Banner
- **D-12:** Sticky banner rendered INSIDE ChatArea, ABOVE the message input field, BELOW the message list.
- **D-13:** Only visible when `conversation.channel_metadata?.window_expired === 'true'`.
- **D-14:** Visual treatment: amber/warning background (`bg-amber-50 border-amber-200 text-amber-800` in light mode), icon (⚠ or clock), text: "The 24-hour Meta messaging window has expired. Automated replies are paused."
- **D-15:** Not dismissible — the state is server-driven. Banner disappears when a new inbound message arrives (which resets window_expired via Phase 11 logic) or when the field becomes false.

### Bot Pause / Resume Controls
- **D-16:** Pause/Resume button placed in the conversation header area — icon button with tooltip ("Pause bot" / "Resume bot").
- **D-17:** Reuses existing `bot_status` field on conversations. Toggle via server action that updates `bot_status` ('active' → 'paused' → 'active').
- **D-18:** Button is present for ALL channels (widget + Meta) — bot_status is channel-agnostic per existing schema.
- **D-19:** Optimistic UI update — toggle immediately in local state, confirm via server action. On error, revert with toast.

### Claude's Discretion
- Exact SVG paths for Instagram/Messenger icons — use recognizable approximations if official brand assets aren't available as open source
- Loading skeleton for channel filter bar if needed
- Exact Tailwind class names for the filter pills active/inactive states

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Inbox Components
- `src/components/chat/conversation-list.tsx` — ConversationList component to extend with icons + filter
- `src/components/chat/chat-area.tsx` — ChatArea component to extend with 24h banner
- `src/components/chat/admin-chat-layout.tsx` — Layout wrapper, understand how list and area compose
- `src/app/(dashboard)/chat/page.tsx` — Page data loading, understand what's fetched
- `src/app/(dashboard)/chat/actions.ts` — Server actions, understand conversation data shape

### Schema (for channel + channel_metadata)
- `supabase/migrations/020_conversations_channel.sql` — channel + channel_metadata columns
- `supabase/migrations/022_conversation_inbound_at.sql` — window_expired flag location
- `supabase/migrations/019_meta_channels.sql` — meta_channels table (page_name, page_id)
- `src/types/database.ts` — TypeScript types for all tables

### Requirements
- `.planning/REQUIREMENTS.md` §METAINBOX — METAINBOX-01, METAINBOX-02, METAINBOX-04, METAINBOX-05, METAINBOX-06

### Prior Phase Context
- `.planning/phases/11-meta-webhook/11-CONTEXT.md` — channel_metadata shape (igsid/page_id for instagram, sender_id/page_id for messenger), window_expired flag

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConversationList` in `src/components/chat/conversation-list.tsx` — add channel icon to each row, add filter pills above list
- `ChatArea` in `src/components/chat/chat-area.tsx` — add 24h warning banner above input
- `AdminChatLayout` in `src/components/chat/admin-chat-layout.tsx` — understand composition before modifying children
- Existing `bot_status` field already on conversations — pause/resume just toggles it
- shadcn/ui `Badge`, `Button`, `Tooltip` — use for bot status badge and pause/resume button

### Established Patterns
- Server components with 'use client' child components for interactive parts (existing chat pattern)
- `sonner` for toast notifications on error
- Tailwind 4 for styling — use existing color tokens
- Server actions for mutations (update bot_status)

### Integration Points
- `conversation.channel` field determines which icon and filter bucket
- `conversation.channel_metadata` JSON contains `window_expired` flag (set by Phase 11)
- `meta_channels` table has `page_name` for display in header — may need join in existing actions.ts query
- `conversations.bot_status` for pause/resume — existing field, existing pattern in chat inbox

</code_context>

<specifics>
## Specific Notes

- Phase 11 sets `channel_metadata->>'window_expired' = 'true'` on conversations when 24h expires. The UI reads this directly from the conversation object — no new API needed.
- The filter is purely client-side — all conversations are already loaded. No pagination concerns for the v1.3 scope.
- ConversationList already renders a list of conversations — adding icons is a row-level change, filter pills are a new element above the list.

</specifics>

<deferred>
## Deferred Ideas

- Channel-specific notification sounds
- Unread count per channel in filter pills
- WhatsApp channel icon/filter
- Read receipt indicators per channel
- Conversation search/filtering by keyword

</deferred>

---

*Phase: 12-multi-channel-inbox-ui*
*Context gathered: 2026-05-05*
