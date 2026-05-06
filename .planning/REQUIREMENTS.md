# Milestone v1.6 Requirements — ManyChat Integration

**Status:** Active
**Milestone:** v1.6 ManyChat Integration
**Created:** 2026-05-06
**Seed document:** `projects/manychat-integration/PLANNING.md`

---

## CHANNEL — ManyChat channel setup (one per org)

- [ ] **CHANNEL-01:** Admin can connect a ManyChat account by entering an API key (stored encrypted via AES-256-GCM)
- [ ] **CHANNEL-02:** Admin can see the generated webhook URL and secret to copy into ManyChat External Request config
- [ ] **CHANNEL-03:** Admin can see a copyable JSON payload template for ManyChat External Request body config
- [ ] **CHANNEL-04:** Admin can test the API connection (verify key validity via ManyChat getFlows endpoint)
- [ ] **CHANNEL-05:** Admin can disconnect (delete) a ManyChat channel

## WEBHOOK — Inbound event ingestion

- [ ] **WEBHOOK-01:** POST /api/manychat/webhook receives External Request events from ManyChat flows
- [ ] **WEBHOOK-02:** Requests with invalid or missing X-Operator-Secret header are rejected with HTTP 403
- [ ] **WEBHOOK-03:** All inbound events are logged to manychat_events with status: matched, unmatched, or error
- [ ] **WEBHOOK-04:** Webhook always returns HTTP 200 after secret validation (prevents ManyChat retry storms)

## ROUTING — Inbound event → action dispatch

- [ ] **ROUTING-01:** Admin can create a routing rule: event_type + condition JSONB → tool_config action
- [ ] **ROUTING-02:** Admin can edit and delete routing rules
- [ ] **ROUTING-03:** When a webhook matches a rule, the configured action (GHL, Twilio, etc.) executes via the existing action engine
- [ ] **ROUTING-04:** Matched events are linked to the action_logs entry via manychat_events.action_log_id

## OUTBOUND — Operator → ManyChat actions

- [ ] **OUTBOUND-01:** manychat_set_field action type sets a subscriber custom field via ManyChat API
- [ ] **OUTBOUND-02:** manychat_add_tag action type adds a tag to a subscriber via ManyChat API
- [ ] **OUTBOUND-03:** manychat_trigger_flow action type triggers an existing ManyChat flow for a subscriber
- [ ] **OUTBOUND-04:** manychat_send_message action type sends a message to a subscriber via ManyChat API

## OBSERVABILITY — Event log + rules UI

- [ ] **OBS-01:** Admin can view a paginated log of all inbound events with status indicators
- [ ] **OBS-02:** Admin can filter the event log by status and date range
- [ ] **OBS-03:** Admin can view the full raw payload of any logged event

---

## Future Requirements

- Multiple ManyChat accounts per org
- Rule priority ordering UI
- Webhook retry handling and dead-letter queue

## Out of Scope

- ManyChat flow creation or editing (ManyChat API does not support this)
- HMAC signature verification (ManyChat does not support it — shared secret header used instead)

---

## Traceability

| Requirement  | Phase | Status  |
|--------------|-------|---------|
| CHANNEL-01   | TBD   | Pending |
| CHANNEL-02   | TBD   | Pending |
| CHANNEL-03   | TBD   | Pending |
| CHANNEL-04   | TBD   | Pending |
| CHANNEL-05   | TBD   | Pending |
| WEBHOOK-01   | TBD   | Pending |
| WEBHOOK-02   | TBD   | Pending |
| WEBHOOK-03   | TBD   | Pending |
| WEBHOOK-04   | TBD   | Pending |
| ROUTING-01   | TBD   | Pending |
| ROUTING-02   | TBD   | Pending |
| ROUTING-03   | TBD   | Pending |
| ROUTING-04   | TBD   | Pending |
| OUTBOUND-01  | TBD   | Pending |
| OUTBOUND-02  | TBD   | Pending |
| OUTBOUND-03  | TBD   | Pending |
| OUTBOUND-04  | TBD   | Pending |
| OBS-01       | TBD   | Pending |
| OBS-02       | TBD   | Pending |
| OBS-03       | TBD   | Pending |
