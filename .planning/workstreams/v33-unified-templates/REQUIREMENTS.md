# v3.3 Settings Nav Cleanup + Unified Templates — Requirements

**Defined:** 2026-07-02
**Core Value:** A single, extensible "Templates" home in Settings that covers every message-authoring surface (Email, generic Messages, WhatsApp) instead of templates being scattered, nav-orphaned, or bolted onto an unrelated "Communications" section.

## Settings Navigation Cleanup

- [x] **NAV-01**: Admin no longer sees a "Call Center" link inside Settings — the surface remains solely under the top-level Calls sidebar item at `/calls/settings`.
- [x] **NAV-02**: Admin finds "Chat Widget" configuration under the Build section of Settings instead of Communications.
- [x] **NAV-03**: The "Communications" section is renamed to "Templates" and contains Email, Messages, and WhatsApp entries.
- [x] **NAV-04**: Adding a future template kind to Settings requires adding one nav item under Templates, reusing a shared section/card pattern — no structural nav rework.

## Messages Templates (new generic quick-reply library)

- [x] **MSG-01**: Admin can create a Messages template with a name, a default body, and optional per-channel body overrides for SMS, Email, and WhatsApp.
- [x] **MSG-02**: Admin can list, edit, and delete Messages templates from `/settings/message-templates`.
- [x] **MSG-03**: Messages templates are org-scoped via RLS like every other tenant table.
- [x] **MSG-04**: Messages templates are explicitly distinct from WhatsApp Business templates — free-form text, no Meta/Zernio approval workflow, usable immediately after saving.
- [x] **MSG-05**: Admin can preview how a template resolves per channel (default body vs. channel override) before saving.

## WhatsApp Templates Reorganization

- [x] **WAT-01**: The existing WhatsApp templates screen is reachable from Settings → Templates (today it is nav-orphaned, reachable only via a contextual "Manage templates" button).
- [x] **WAT-02**: Admin can search WhatsApp templates by name.
- [x] **WAT-03**: Admin can filter WhatsApp templates by status (Approved/Pending/Rejected/Paused/Disabled), category, and language.
- [x] **WAT-04**: The existing dual-provider behavior (Meta Cloud API vs. Zernio) and their sync/approval mechanics are preserved unchanged.
- [x] **WAT-05**: Existing contextual entry points (integration panel "Manage templates" button, chat template picker fallback) continue to work, now landing on the relocated page.

## Future Requirements (deferred, not this milestone)

| Feature | Reason |
|---------|--------|
| Messages templates as quick-insert in the chat/inbox composer | Settings-only CRUD ships first; composer integration is a separate, smaller follow-up once the data model is proven |
| Messages templates selectable as SMS/WhatsApp campaign body | Mirrors the Email template campaign picker (Phase 121) but needs its own scoping pass |
| Folder/category hierarchy for WhatsApp templates | Search + filter addresses the reported pain point; revisit only if that proves insufficient |
| Calls/phone system settings architecture rethink | User explicitly wants to think this through separately — out of scope here, not forgotten |

## Out of Scope

| Feature | Reason |
|---------|--------|
| Redesigning Calls routing, ownership, or `/calls/settings` itself | Explicitly deferred by the user; this milestone only removes the redundant Settings nav link |
| Changing WhatsApp template approval/sync mechanics (Meta or Zernio APIs) | Real external approval workflow is out of scope — only the local browsing/organization UX changes |
| Unifying `whatsapp_templates` and `zernio_whatsapp_templates` into one table | Not requested; both providers stay live and independently synced |

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| NAV-01 | Phase 122 | Complete |
| NAV-02 | Phase 122 | Complete |
| NAV-03 | Phase 125 | Complete |
| NAV-04 | Phase 125 | Complete |
| MSG-01 | Phase 124 | Complete |
| MSG-02 | Phase 124 | Complete |
| MSG-03 | Phase 124 | Complete (RLS policy code-complete in migration 1233; pending remote `supabase db push` before live in prod) |
| MSG-04 | Phase 124 | Complete |
| MSG-05 | Phase 125 | Complete |
| WAT-01 | Phase 123 | Complete |
| WAT-02 | Phase 123 | Complete |
| WAT-03 | Phase 123 | Complete |
| WAT-04 | Phase 123 | Complete |
| WAT-05 | Phase 123 | Complete |

**Coverage:**
- v3.3 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0

---
*Requirements defined: 2026-07-02*
*Roadmap created: 2026-07-02 (Phases 122-125, workstream v33-unified-templates)*
