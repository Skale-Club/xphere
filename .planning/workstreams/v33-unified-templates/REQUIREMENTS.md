# v3.3 Settings Nav Cleanup + Unified Templates — Requirements

**Defined:** 2026-07-02
**Core Value:** A single, extensible "Templates" home in Settings that covers every message-authoring surface (Email, generic Messages, WhatsApp) instead of templates being scattered, nav-orphaned, or bolted onto an unrelated "Communications" section.

## Settings Navigation Cleanup

- [ ] **NAV-01**: Admin no longer sees a "Call Center" link inside Settings — the surface remains solely under the top-level Calls sidebar item at `/calls/settings`.
- [ ] **NAV-02**: Admin finds "Chat Widget" configuration under the Build section of Settings instead of Communications.
- [ ] **NAV-03**: The "Communications" section is renamed to "Templates" and contains Email, Messages, and WhatsApp entries.
- [ ] **NAV-04**: Adding a future template kind to Settings requires adding one nav item under Templates, reusing a shared section/card pattern — no structural nav rework.

## Messages Templates (new generic quick-reply library)

- [ ] **MSG-01**: Admin can create a Messages template with a name, a default body, and optional per-channel body overrides for SMS, Email, and WhatsApp.
- [ ] **MSG-02**: Admin can list, edit, and delete Messages templates from `/settings/message-templates`.
- [ ] **MSG-03**: Messages templates are org-scoped via RLS like every other tenant table.
- [ ] **MSG-04**: Messages templates are explicitly distinct from WhatsApp Business templates — free-form text, no Meta/Zernio approval workflow, usable immediately after saving.
- [ ] **MSG-05**: Admin can preview how a template resolves per channel (default body vs. channel override) before saving.

## WhatsApp Templates Reorganization

- [ ] **WAT-01**: The existing WhatsApp templates screen is reachable from Settings → Templates (today it is nav-orphaned, reachable only via a contextual "Manage templates" button).
- [ ] **WAT-02**: Admin can search WhatsApp templates by name.
- [ ] **WAT-03**: Admin can filter WhatsApp templates by status (Approved/Pending/Rejected/Paused/Disabled), category, and language.
- [ ] **WAT-04**: The existing dual-provider behavior (Meta Cloud API vs. Zernio) and their sync/approval mechanics are preserved unchanged.
- [ ] **WAT-05**: Existing contextual entry points (integration panel "Manage templates" button, chat template picker fallback) continue to work, now landing on the relocated page.

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
| NAV-01 | TBD | Pending roadmap |
| NAV-02 | TBD | Pending roadmap |
| NAV-03 | TBD | Pending roadmap |
| NAV-04 | TBD | Pending roadmap |
| MSG-01 | TBD | Pending roadmap |
| MSG-02 | TBD | Pending roadmap |
| MSG-03 | TBD | Pending roadmap |
| MSG-04 | TBD | Pending roadmap |
| MSG-05 | TBD | Pending roadmap |
| WAT-01 | TBD | Pending roadmap |
| WAT-02 | TBD | Pending roadmap |
| WAT-03 | TBD | Pending roadmap |
| WAT-04 | TBD | Pending roadmap |
| WAT-05 | TBD | Pending roadmap |

**Coverage:**
- v3.3 requirements: 14 total
- Mapped to phases: 0
- Unmapped: 14 (roadmap pending)

---
*Requirements defined: 2026-07-02*
