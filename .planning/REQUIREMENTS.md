# Operator v1.3 Requirements

## Milestone: v1.3 — Google Reviews Widget + Meta Messaging

**Goal:** Add two platform-level reusable modules — an embeddable Google Reviews widget for client sites, and Instagram/Facebook Messenger as new channels integrated into the existing chat inbox.

---

## v1.3 Requirements

### GREV — Google Reviews (Location & Capture)

- [x] **GREV-01**: Admin can register a Google location (name, address, Place ID, Maps link, category, client name)
- [x] **GREV-02**: System fetches up to 5 reviews from Google Places API (New) and stores them in Supabase with `fetched_at` timestamp
- [x] **GREV-03**: Admin can manually trigger a review refresh from the location dashboard
- [x] **GREV-04**: Dashboard shows last sync date, review count, and last error per location
- [x] **GREV-05**: System enforces minimum 24h between API fetches per location to control costs

### GWDGT — Reviews Widget (Embed & Display)

- [x] **GWDGT-01**: Admin can generate an embeddable `<script>` tag with a unique per-location token for use on client sites
- [x] **GWDGT-02**: Widget renders reviews in 4 layouts: carousel, grid, simple list, compact block
- [x] **GWDGT-03**: Admin can configure widget appearance: primary color, star color, dark/light theme, show/hide photo/date/Google button, border radius, max-width
- [x] **GWDGT-04**: Widget loads reviews from a public token-scoped endpoint (no auth, no live Google API call at render time)
- [x] **GWDGT-05**: Widget displays mandatory "Powered by Google" attribution per Google API policy
- [x] **GWDGT-06**: Widget fails gracefully — silently hides without breaking the host page if data is unavailable

### META — Meta Channel Connection

- [x] **META-01**: Admin can connect a Facebook Page via Meta OAuth and see its linked Instagram Professional account
- [x] **META-02**: System completes the full token exchange chain (short-lived → long-lived → page access token) and stores the page token encrypted with AES-256-GCM
- [x] **META-03**: Admin can view connected Meta channels with connection status, last sync, and active permissions
- [x] **META-04**: Admin can disconnect a Meta channel
- [x] **META-05**: System detects token expiry/revocation (error 190) and shows a reconnect prompt in channel settings
- [x] **META-06**: Admin can link an existing automation to a Meta channel (Instagram DM and Messenger independently)

### METAEV — Meta Events & Automation

- [x] **METAEV-01**: System receives and verifies inbound events from Instagram and Messenger via a single unified Meta webhook (HMAC-SHA256 signature verification)
- [x] **METAEV-02**: Inbound Meta messages create conversations in the existing chat inbox with the correct channel type (`instagram` or `messenger`)
- [x] **METAEV-03**: Automation bound to a Meta channel fires on incoming messages and can invoke existing action engine tools (`executeAction`)
- [x] **METAEV-04**: Automation supports keyword triggers — fires when message contains a configured keyword
- [x] **METAEV-05**: System enforces the 24h Meta messaging window — automated replies are blocked after 24h from last inbound user message

### METAINBOX — Multi-Channel Inbox

- [x] **METAINBOX-01**: Each conversation in the inbox shows a channel icon and name (website / Instagram / Messenger)
- [x] **METAINBOX-02**: Admin can filter inbox by channel (all / website / instagram / messenger) and by bot state (bot-active / bot-paused)
- [ ] **METAINBOX-03**: Manual admin replies are sent via the conversation's origin channel (Instagram → IG API, Messenger → Messenger API, widget → existing path)
- [x] **METAINBOX-04**: Conversation header shows channel, connected account name, and current bot status
- [x] **METAINBOX-05**: System shows a visual warning in conversations where the 24h Meta reply window has expired
- [x] **METAINBOX-06**: Admin can pause/resume bot per conversation across all channels (reuses existing `bot_status` field)

---

## API Constraints (Not Requirements — Context for Planning)

- Google Places API: maximum 5 reviews per location, no pagination, no control over which 5 are returned
- Google Places API: reviews fall under Enterprise+Atmosphere SKU — 1,000 free requests/month, then $25/1,000
- Google ToS: review data treated as short-lived cache (refreshed periodically), not permanent storage; `place_id` is the only field that can be stored indefinitely
- "New follower" Instagram event: does NOT exist — deprecated 2018; first DM is the closest trigger
- Meta App Review: `instagram_manage_messages` + `pages_messaging` both require Advanced Access approval before real users can connect; Business Verification is a prerequisite (start immediately)
- Meta 24h window: automated replies blocked after 24h; only `HUMAN_AGENT` tag valid up to 7 days; nothing after 7 days
- Meta Message Tags: all tags except `HUMAN_AGENT` deprecated February 9, 2026
- Meta token lifecycle: Page Access Tokens don't expire but are invalidated on revocation; system must handle error 190

---

## Future Requirements (Deferred)

- Replies after 24h Meta window using `HUMAN_AGENT` tag — requires separate App Review submission
- WhatsApp Business API as new channel — architecture prepared, not implemented
- SMS channel — architecture prepared, not implemented
- Email channel — architecture prepared, not implemented
- Google My Business API (> 5 reviews per location) — requires separate multi-week approval process
- Widget analytics dashboard (review views, click-through on "View on Google")
- Visitor identity collection before widget chat
- Instagram story reply automation trigger
- Instagram comment keyword automation trigger (requires `instagram_manage_comments` permission)
- System User tokens for Meta (eliminates per-user OAuth overhead — v1.4+)

---

## Out of Scope

- "New follower" trigger — event not available in Meta API
- Outbound promotional messaging on Meta — violates 24h window policy
- Widget for non-Google review sources (Yelp, TripAdvisor) — v1.4+
- Meta ad campaign management
- Instagram post scheduling or publishing
- Facebook Page management (comments, posts)

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| GREV-01 | Phase 8 | Complete |
| GREV-02 | Phase 8 | Complete |
| GREV-03 | Phase 8 | Complete |
| GREV-04 | Phase 8 | Complete |
| GREV-05 | Phase 8 | Complete |
| GWDGT-01 | Phase 9 | Complete |
| GWDGT-02 | Phase 9 | Complete |
| GWDGT-03 | Phase 9 | Complete |
| GWDGT-04 | Phase 9 | Complete |
| GWDGT-05 | Phase 9 | Complete |
| GWDGT-06 | Phase 9 | Complete |
| META-01 | Phase 10 | Complete |
| META-02 | Phase 10 | Complete |
| META-03 | Phase 10 | Complete |
| META-04 | Phase 10 | Complete |
| META-05 | Phase 10 | Complete |
| META-06 | Phase 10 | Complete |
| METAEV-01 | Phase 11 | Not started |
| METAEV-02 | Phase 11 | Not started |
| METAEV-03 | Phase 11 | Not started |
| METAEV-04 | Phase 11 | Not started |
| METAEV-05 | Phase 11 | Not started |
| METAINBOX-01 | Phase 12 | Not started |
| METAINBOX-02 | Phase 12 | Not started |
| METAINBOX-03 | Phase 13 | Not started |
| METAINBOX-04 | Phase 12 | Not started |
| METAINBOX-05 | Phase 12 | Not started |
| METAINBOX-06 | Phase 12 | Not started |

**Total: 27/27 requirements mapped — 17 complete, 10 pending**
