# Skale Club — voice

What exists today in org `b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5`, how to operate
it, and what is still not ready.

## The path of a keychain order

1. Somebody fills in `/nfc-order` (or `/br/nfc-order`) on skale.club.
2. The site freezes the quote onto the lead, fires the Telegram alert and queues
   the lead for Xphere (`POST /api/v1/leads`, durable outbox in the `skaleclub`
   repo). Since `feat(nfc): hand Xphere the whole order…` the envelope also
   carries the price snapshot, the `countryCode`, the logo file name and a
   derived `lang` field (`/br` → `pt-BR`; otherwise phone country → dial code →
   `en`).
3. Xphere emits `lead.captured`, which triggers the **Skale Club — NFC keychain
   order callback** workflow (`nfc-order-callback.yaml`).
4. The workflow checks the form is `nfc-keychain-order`, picks the queue by
   `lang` and calls `campaign_enroll_call` — which **only enqueues**.
5. The campaign engine (`/api/cron/campaign-tick`, running on skale-cron) dials
   inside the campaign's window, with the order details in the prompt.
6. The end-of-call report comes back through `/api/vapi/calls`, closes the
   `campaign_contacts` row and writes the transcript, recording and call
   evaluation to `calls`.

## The pieces

| Piece | Id |
|---|---|
| Vapi assistant — reception | `80dd9b79-fd39-457c-834a-7b0dd217fee4` (the one answering `+1 312 878-0637`) |
| Agent (prompt) — reception | slug `voice-reception`, bilingual, with `save_caller_message` |
| Agent (prompt) — scheduling | slug `voice-scheduling`, delegated to by reception, with `check_meeting_times` and `book_meeting` |
| Event type | `conversa-inicial` — 30 min, video, Mon–Fri 09:00–17:00 (New York) |
| Vapi assistant — PT | `d8b13b3b-980d-4269-a64f-393343a01ad1` |
| Vapi assistant — EN | `efcd8778-7497-49c8-9082-fe2e59ca0081` |
| Agent (prompt) — PT | slug `voice-nfc-callback-pt` |
| Agent (prompt) — EN | slug `voice-nfc-callback-en` |
| Campaign — PT | `NFC callback — PT`, timezone `America/Sao_Paulo` |
| Campaign — EN | `NFC callback — EN`, timezone `America/New_York` |
| Caller id | `+1 312 878-0637` (the same number that answers) |
| Workflow | `Skale Club — NFC keychain order callback` |

Both campaigns are **evergreen**: they stay open waiting for orders instead of
completing themselves when the queue empties. Window: 09:00–18:00, Monday to
Friday, in each one's own timezone. Retry: two attempts, half an hour and then
four hours; voicemail is never redialled.

## Operating it

**Change what the robot says:** edit `scripts/skaleclub-voice/callback-{pt,en}.md`,
run `npx tsx --env-file=.env.local scripts/setup-skaleclub-voice.ts --apply`
(which publishes a new prompt version), then push to Vapi from
`Calls → Voice settings → Assistants → Push Config to Vapi`.

**Before pushing anything**, run the diff:

```bash
STRICT=1 VAPI_PUSH_TEST_ORG_ID=b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5 VAPI_PUSH_TEST_ASSISTANT_ID=<assistant> npx vitest run --config vitest.manual.config.ts tests/manual/vapi-push-diff.test.ts
```

**Change the window, the pacing or the retry:** they are campaign columns
(`dial_window`, `calls_per_minute`, `retry_policy`). An invalid `dial_window`
blocks nothing — the system deliberately falls back to "dial at any hour", so a
configuration mistake cannot stop dialling across the whole platform.

**Stop everything now:** put the campaigns in `paused`. The workflow keeps
enqueuing and the rows wait until somebody resumes. Enrolment only wakes a
campaign that was `completed` — that is, one that ran dry on its own. `paused`,
`draft` and `scheduled` are somebody's decision and it does not undo them.

**Do not call one particular person:** turn on do-not-disturb for the contact
(channel *calls*). Enrolment honours it — and when the workflow only knows the
phone number, it looks up the contact that owns that number before deciding.

## Who answers the phone

`+1 312 878-0637` is answered by the bilingual receptionist: it replies in the
caller's language, knows the catalogue, may quote the **published** product
prices and nothing beyond them, treats any keychain figure as an estimate, and
logs the call with `save_caller_message` — which opens a task, an email and a
Telegram message through the automation that already existed.

**It books.** When the caller wants to speak to the team, reception hands the
call to the **scheduling specialist** (agent `voice-scheduling`, wired by
delegation — the caller stays on the same line, with the same voice). It reads
the real calendar, offers two times, takes the email, reads everything back and
only then books.

The only thing it books is the **intro call**: 30 minutes, by video, Mon–Fri
09:00–17:00 New York time. Public page for the same calendar:
<https://xphere.app/book/vanildo/conversa-inicial>.

On a phone call it **cannot** book without reading the details back and hearing
a yes — the check reads the call transcript, so the robot cannot talk itself
into it. It will not book without an email either: that is where the invite and
the video link go.

**Before changing its script, rehearse:**

```bash
VOICE_REHEARSAL_ORG_ID=b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5 VOICE_REHEARSAL_ASSISTANT_ID=80dd9b79-fd39-457c-834a-7b0dd217fee4 npx vitest run --config vitest.manual.config.ts tests/manual/reception-rehearsal.test.ts
```

Seven callers go past the live prompt in both languages, dialling nothing. Its
first run caught four real problems, including a car-warranty robocall becoming
a CRM contact. Read-only tools hit the real ingress, so what the assistant sees
is what a caller would produce.

**And rehearse the two that call people**, which is the riskier half:

```bash
VOICE_REHEARSAL_ORG_ID=b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5 npx vitest run --config vitest.manual.config.ts tests/manual/callback-rehearsal.test.ts
```

## What is still not ready

- **The site does not offer booking yet** (`booking_enabled: false` in
  `xphere_settings`), so somebody arriving through the form does not see the
  same calendar the robot uses.
- **The org's knowledge base is empty** (only `dummy` and `test`). Everything
  reception knows lives in the prompt itself, which is fine for a small
  catalogue and stops scaling once it grows.
- **The prompt's date line uses the organisation's timezone**
  (`America/New_York`) even on the PT robot, because the org is what sets it.
  It does not affect order confirmation, which books nothing.
- **The form does not ask for explicit call consent.** The promise is on the
  page and the field is called "Qual é o seu WhatsApp?"; a line in the last step
  saying we will call to confirm would be worth adding.
- **Skale Club and Cuts & Culture share one Vapi key** — both `integrations`
  rows hold the same secret, and both orgs' assistants live in the same account.
  The rule "never push config to Cuts & Culture" is held up only by the code
  (`assistant_mappings.entry_agent_id` is null there) and by the
  `STRICT=1 tests/manual/vapi-push-diff.test.ts` fence, not by credential
  isolation. Separating them would need a second Vapi account.
- **No call in this org has ever closed the loop.** There is a single `calls`
  row, from 2026-08-01, stuck at `ringing`: the end-of-call report has never
  arrived here, not once. The receiving half is proved
  (`tests/manual/end-of-call-loop.test.ts`), and Vapi's own delivery is
  evidenced by Cuts & Culture running on the same `serverMessages` default —
  but the first real call is what settles it.

> GoHighLevel used to be listed here as broken. It is **legacy** — the product
> does not use it any more; everything lives in Xphere. The `integrations` row
> still says active, which is stale data, not a connection.
