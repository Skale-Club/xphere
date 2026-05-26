---
phase: 108-channel-identities
plan: 04
subsystem: contacts/channel-identity-wiring
tags: [contacts, channel-identity, webhooks, lookup-first, D-03, D-04]
completed: 2026-05-26
requires: [108-03]
provides: [108-05]
affects: [whatsapp-webhook, evolution-webhook, telegram-webhook, link-conversations]
tech-stack:
  patterns:
    - lookup-first contact resolution (channel identity → phone → insert)
    - cross-channel identity attach (D-03b)
key-files:
  modified:
    - src/lib/whatsapp/process-message.ts
    - src/lib/evolution/process-event.ts
    - src/lib/telegram/process-update.ts
    - src/app/(dashboard)/contacts/actions.ts
decisions:
  - "D-03 lookup-first ordering applied to all 3 contact-creating webhooks"
  - "D-03b cross-channel attach fires on every phone-match, new-insert, and 23505 recovery branch"
  - "D-04: linkConversationsToContacts writes channel identity after successful UPDATE using CHANNEL_TO_PROVIDER map (widget→webchat)"
  - "Pitfall 1 honored: Telegram externalId = String(msg.chat.id) directly, NOT normalisePhone"
  - "Pitfall 3 honored: linkConversationsToContacts SELECT widened to include channel, channel_metadata, org_id"
metrics:
  duration: 13min
  tasks: 4
  files: 4
---

# Phase 108 Plan 04: Wire Channel-Identity Lookup-First Across Webhooks Summary

Retrofitted the four contact-creation/linking call sites to consult and write `contact_channel_identities`: lookup-first ordering in 3 webhooks (whatsapp, evolution, telegram) plus the `linkConversationsToContacts` server action. Each successful contact resolution now writes its provider+external_id, enabling D-03b cross-channel attach (lead reached on Instagram + WhatsApp lands on the same contact).

## One-liner

Phase 108's user-visible value: channel-identity lookup-first in all 3 contact-creating webhooks + identity-on-link in `linkConversationsToContacts`, using `findByChannelIdentity` / `attachChannelIdentity` from Plan 03.

## Diff Summary

| File | Insertions | Deletions |
| --- | ---: | ---: |
| `src/lib/whatsapp/process-message.ts` | 63 | 41 |
| `src/lib/evolution/process-event.ts` | 56 | 39 |
| `src/lib/telegram/process-update.ts` | 63 | 47 |
| `src/app/(dashboard)/contacts/actions.ts` | 31 | 4 |

## Commits

- `7126459` feat(108-04): wire whatsapp handler to channel identity lookup-first
- `712d770` feat(108-04): wire evolution handler to channel identity lookup-first
- `f86e338` feat(108-04): wire telegram handler to channel identity lookup-first
- `7ed4eeb` feat(108-04): write channel identity on linkConversationsToContacts

## Per-File Behavior

### `src/lib/whatsapp/process-message.ts`
- Added imports: `findByChannelIdentity, attachChannelIdentity` + `ChannelProvider` type.
- Provider derived dynamically: `msg.provider === 'evolution' ? 'evolution' : 'whatsapp'`.
- externalId = `msg.fromJid` (Cloud `wa_id` / Evolution JID).
- Order: `findByChannelIdentity` → phone lookup → INSERT (existing 23505 recovery preserved).
- `attachChannelIdentity` fires on **phone-match** (D-03b), **new-insert**, and **23505-recovery** branches.

### `src/lib/evolution/process-event.ts`
- Added imports: `findByChannelIdentity, attachChannelIdentity` + `ChannelProvider` type.
- Provider hardcoded: `'evolution'`.
- externalId = `m.key?.remoteJid ?? ''`.
- Same lookup-first order, same triple-attach on all success branches.
- Kept legacy `source: 'whatsapp'` on contacts INSERT (back-compat — channel identity row distinguishes evolution).

### `src/lib/telegram/process-update.ts`
- Added imports: `findByChannelIdentity, attachChannelIdentity` + `ChannelProvider` type.
- Provider hardcoded: `'telegram'`.
- externalId = the existing `chatId` variable (which is `String(msg.chat.id)`) — **passed verbatim**, NOT through `normalisePhone` (Pitfall 1).
- Phone fallback retains existing Phase 107 back-compat (chat_id stored in `visitor_phone` masquerading as phone).
- Triple-attach on all success branches.

### `src/app/(dashboard)/contacts/actions.ts`
- Added `attachChannelIdentity` to existing `@/lib/contacts/server` import; added `ChannelProvider` type import.
- Declared module-scope `CHANNEL_TO_PROVIDER` map: whatsapp/telegram/messenger/instagram pass through; **widget → webchat** remap.
- Widened SELECT in `linkConversationsToContacts` from `'id, visitor_phone'` to `'id, visitor_phone, channel, channel_metadata, org_id'` (Pitfall 3).
- After every successful `conversations.update({ contact_id })`:
  - Phone channels (whatsapp/telegram/webchat) → externalId = `conv.visitor_phone`.
  - Meta channels (instagram/messenger) → externalId = `channel_metadata.sender_id` when present; skipped otherwise (D-04 conservative).
  - `attachChannelIdentity` called only when provider + externalId + `conv.org_id` are all truthy.

## D-03b Cross-Channel Attach Confirmation

All three webhooks invoke `attachChannelIdentity` on **three** branches each (9 total cross-channel-attach call sites):

| Webhook | phone-match branch | new-insert branch | 23505-recovery branch |
| --- | :---: | :---: | :---: |
| whatsapp | ✓ | ✓ | ✓ |
| evolution | ✓ | ✓ | ✓ |
| telegram | ✓ | ✓ | ✓ |

Plus `linkConversationsToContacts` adds a 10th attach site on the link path.

## Pitfalls Honored

- **Pitfall 1** (Telegram): `externalId = chatId` (string from `String(msg.chat.id)`) — NO normalisePhone applied. The legacy `normalisePhone(chatId)` call remains only for the phone-fallback lookup branch (back-compat).
- **Pitfall 3** (link action): SELECT widened to include `channel, channel_metadata, org_id`. `org_id` is used directly for the `attachChannelIdentity` call (RLS still applies via the user-scoped client).

## No `.upsert` Introduced

Searched all 4 modified files: no `.upsert(` calls. All identity writes go through `attachChannelIdentity` which uses INSERT + 23505 recovery (Plan 03 helper, D-03a).

## Verification

- `npm run build` — exits 0 (compiled successfully in ~21–26s for each task).
- All 4 files contain `findByChannelIdentity` or `attachChannelIdentity` references.
- 23505 recovery preserved in all 3 webhooks.
- Webhooks remain HTTP-200 safe (outer try/catch unchanged; `attachChannelIdentity` swallows non-23505 errors internally).

## Deviations from Plan

None — plan executed exactly as written. Each task's skeleton from the plan was followed verbatim with minor formatting adjustments to match existing code style.

## Self-Check: PASSED

- File `src/lib/whatsapp/process-message.ts` — FOUND, contains findByChannelIdentity + attachChannelIdentity
- File `src/lib/evolution/process-event.ts` — FOUND, contains findByChannelIdentity + attachChannelIdentity
- File `src/lib/telegram/process-update.ts` — FOUND, contains findByChannelIdentity + attachChannelIdentity
- File `src/app/(dashboard)/contacts/actions.ts` — FOUND, contains CHANNEL_TO_PROVIDER + attachChannelIdentity
- Commits 7126459, 712d770, f86e338, 7ed4eeb — all present in `git log`
- `npm run build` exit 0
