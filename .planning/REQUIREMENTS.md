# Milestone v1.7 Requirements — Google Contacts Integration

**Status:** Active
**Milestone:** v1.7 Google Contacts Integration
**Created:** 2026-05-06

---

## GCONTACTS — Google account connection (per org)

- [ ] **GCONTACTS-01:** Admin can connect a Google account via OAuth (Google OAuth 2.0 per org, stored encrypted via AES-256-GCM)
- [ ] **GCONTACTS-02:** Admin can disconnect the Google account integration
- [ ] **GCONTACTS-03:** Admin can see the connection status (connected / not connected) in /integrations

## ACTIONS — Google Contacts action types in the action engine

- [ ] **ACTIONS-01:** `google_contacts_create` action type creates a contact in Google Contacts with standard fields (name, email, phone, company, notes)
- [ ] **ACTIONS-02:** `google_contacts_update` action type updates fields on an existing contact identified by email
- [ ] **ACTIONS-03:** `google_contacts_find` action type searches for a contact by email or phone and returns matching data
- [ ] **ACTIONS-04:** `google_contacts_delete` action type removes a contact from Google Contacts identified by email

---

## Future Requirements

- Sync bidirecional (Google Contacts → GHL)
- Mapeamento de campos customizável por org
- Múltiplas contas Google por org
- Paginação de resultados no find_contact

---

## Out of Scope (v1.7)

- Google Calendar integration
- Google Drive / Gmail integration
- Sync automático em background (cron-based)
- Webhook inbound do Google

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| GCONTACTS-01 | Phase 27 | Complete |
| GCONTACTS-02 | Phase 27 | Complete |
| GCONTACTS-03 | Phase 29 | Pending |
| ACTIONS-01 | Phase 28 | Pending |
| ACTIONS-02 | Phase 28 | Pending |
| ACTIONS-03 | Phase 28 | Pending |
| ACTIONS-04 | Phase 28 | Pending |
