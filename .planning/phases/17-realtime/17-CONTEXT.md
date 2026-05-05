# Phase 17: REALTIME - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Mode:** auto

<domain>
## Phase Boundary

Replace the existing polling in `src/components/chat/admin-chat-layout.tsx` (30s for conversations, 15s for messages) with Supabase Realtime `postgres_changes` subscriptions. New conversations and new messages appear in the admin inbox within seconds without polling. Subscription cleanup is correct on navigation. RLS already scopes events per-org.

</domain>

<decisions>
## Implementation Decisions

### Subscription Strategy
- **D-01:** Use `supabase.channel('chat-inbox-{orgId}').on('postgres_changes', ...)` from the browser client (`src/lib/supabase/client.ts`).
- **D-02:** Two subscription channels:
  - `conversations` table — listen for INSERT and UPDATE events (new conversation arrives, or `last_message`/`bot_status` changes affect the list)
  - `conversation_messages` table — listen for INSERT events scoped to the currently-open conversation_id
- **D-03:** Realtime must be enabled on the `conversations` and `conversation_messages` tables in Supabase. If not, document this as a setup step in the SUMMARY (the publication might already include them via the `supabase_realtime` publication).

### Polling Replacement
- **D-04:** Remove the `setInterval(fetchConversations, ...)` and `setInterval(fetchMessages, ...)` calls in `admin-chat-layout.tsx`.
- **D-05:** Keep the **initial** `fetchConversations()` and `fetchMessages()` calls — these warm up the lists. Realtime takes over for updates only.
- **D-06:** When `selectedConversationId` changes, unsubscribe from the previous message channel and subscribe to the new one.

### Event Handlers
- **D-07:** Conversations channel handlers:
  - INSERT → prepend the new conversation to the list
  - UPDATE → find by id and replace in-place; preserve sort order (most recent `last_message_at` first — same as initial fetch)
  - DELETE → not handled in this phase (out of scope)
- **D-08:** Messages channel handler:
  - INSERT → if `conversation_id === selectedConversationId`, append to messages array; ignore optimistic temp messages already in the array (de-dup by id)

### RLS / Org Scoping
- **D-09:** RLS on `conversations` and `conversation_messages` already scopes by `org_id`. The browser client uses the user's session, so the user only receives events for their own org's rows. No additional filter needed in the realtime subscription.
- **D-10:** Realtime respects RLS only if `private: true` is set OR if the publication uses RLS. If we're using the default supabase_realtime publication, scope by adding a server-side filter `filter: 'org_id=eq.<currentOrgId>'` as a defense-in-depth. Get currentOrgId from the existing fetch (don't add another query).

### Cleanup
- **D-11:** Both subscriptions return `() => supabase.removeChannel(channel)` from their useEffect — prevents zombies on navigation.
- **D-12:** Browser DevTools should show no leftover websocket channels after navigating away from `/chat`.

### Claude's Discretion
- Whether to extract a `useChatRealtime()` custom hook or keep the subscriptions inline in admin-chat-layout
- Exact event handler de-dup logic (Set, .filter, etc.)
- Optional toast on new conversation arrival

</decisions>

<canonical_refs>
## Canonical References

### Modified Files
- `src/components/chat/admin-chat-layout.tsx` — current polling lives here at lines ~58-86

### Patterns to Match
- `src/lib/supabase/client.ts` — browser client factory
- `src/types/chat.ts` — ConversationSummary, ConversationMessage types

### Supabase Docs (Context7-fetchable)
- `@supabase/supabase-js` — `client.channel(...).on('postgres_changes', { event, schema, table, filter }, callback).subscribe()` and `client.removeChannel(channel)`

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Polling Code
```tsx
// Lines 59-66
useEffect(() => {
  fetchConversations()
  const interval = setInterval(
    fetchConversations,
    selectedConversationId ? 15000 : 30000
  )
  return () => clearInterval(interval)
}, [selectedConversationId, fetchConversations])

// Lines 73-86
useEffect(() => {
  if (!selectedConversationId) {
    setMessages([])
    return
  }
  fetchMessages(selectedConversationId)
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchMessages(selectedConversationId)
    }
  }, 15000)
  return () => clearInterval(interval)
}, [selectedConversationId, fetchMessages])
```

### Reusable Patterns
- `createClient()` from `@/lib/supabase/client` already used in admin-chat-layout
- `useState`/`useEffect` lifecycle conventions throughout chat components

### Integration Points
- The realtime subscriptions live alongside the existing fetch logic; initial fetch stays, polling intervals removed
- Optimistic message append already exists (line 92-99 area) — realtime INSERT for own message must de-dup against the temp id

</code_context>

<specifics>
## Specific Notes

- The `supabase.channel()` call is on the browser client. The user's auth session already scopes via RLS.
- Test with two browser sessions in different orgs to verify isolation.
- Open DevTools → Network → WS to confirm cleanup on navigation.
- Realtime must be enabled in Supabase. The CLI command is: `ALTER PUBLICATION supabase_realtime ADD TABLE conversations, conversation_messages;` — likely needs a new migration `024_chat_realtime_publication.sql`.

</specifics>

<deferred>
## Deferred Ideas

- DELETE event handling (deletion is rare; manual refresh acceptable)
- Realtime broadcast for typing indicators
- Presence (who else is viewing the conversation)
- Notification sounds on new messages

</deferred>

---

*Phase: 17-realtime*
*Context gathered: 2026-05-05*
