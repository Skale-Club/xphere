# v3.1 Websites Lead Ingestion - Requirements

## API Security

- [x] **XLI-01**: API keys support a least-privilege `leads:write` scope.
- [x] **XLI-02**: The existing contacts endpoint enforces its declared `contacts:write` scope.
- [x] **XLI-03**: Lead ingestion resolves `org_id` exclusively from the verified bearer key.
- [x] **XLI-04**: A validation endpoint returns only organization identity, granted scopes, and supported capabilities.
- [x] **XLI-05**: Invalid, revoked, or under-scoped keys return stable 401/403 responses without leaking organization data.

## Lead Ingestion

- [x] **XLI-06**: `POST /api/v1/leads` accepts the versioned Websites lead envelope and rejects invalid or oversized payloads.
- [x] **XLI-07**: Every accepted submission creates one organization-scoped `lead_ingestions` receipt protected by RLS.
- [x] **XLI-08**: Replaying the same event and payload returns the existing receipt without creating another event.
- [x] **XLI-09**: Reusing an event ID with a different payload returns a 409 conflict.
- [x] **XLI-10**: Contact matching uses normalized phone, then normalized email, inside the authenticated organization.
- [x] **XLI-11**: A new contact enters lifecycle stage `lead`; an existing contact keeps its lifecycle stage and richer fields.
- [x] **XLI-12**: Multiple unique submissions by one person produce one contact and multiple receipts.

## Workflow and Operations

- [x] **XLI-13**: Every unique receipt emits one `lead.captured` workflow event with lead, contact, source, answers, and attribution variables.
- [x] **XLI-14**: A newly created contact also emits the existing `contact.created` event; an existing contact does not.
- [x] **XLI-15**: Workflow dispatch failure does not fail or roll back an accepted lead receipt.
- [x] **XLI-16**: API key `last_used_at`, receipt metadata, and event dispatch audit are recorded without plaintext keys or lead PII in logs.
- [x] **XLI-17**: Public API documentation replaces the obsolete global-key/fire-and-forget Skaleclub example.

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| XLI-01 | Phase 111 | Complete |
| XLI-02 | Phase 111 | Complete |
| XLI-03 | Phase 111 | Complete |
| XLI-04 | Phase 111 | Complete |
| XLI-05 | Phase 111 | Complete |
| XLI-06 | Phase 112 | Complete |
| XLI-07 | Phase 112 | Complete |
| XLI-08 | Phase 112 | Complete |
| XLI-09 | Phase 112 | Complete |
| XLI-10 | Phase 112 | Complete |
| XLI-11 | Phase 112 | Complete |
| XLI-12 | Phase 112 | Complete |
| XLI-13 | Phase 113 | Complete |
| XLI-14 | Phase 113 | Complete |
| XLI-15 | Phase 113 | Complete |
| XLI-16 | Phase 113 | Complete |
| XLI-17 | Phase 113 | Complete |
