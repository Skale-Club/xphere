// tests/ghl-reengagement-runner.test.ts
// Phase 32 — REENG-02, REENG-04, REENG-10, REENG-11, REENG-12 + edge cases.
// RED until Plan 03 ships src/lib/automations/ghl-reengagement/runner.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FIXTURE_CREDENTIALS,
  FIXTURE_LOST_OLD_PAGE_1,
  FIXTURE_LOST_OLD_PAGE_2,
  FIXTURE_LOST_RECENT_ONLY,
  FIXTURE_EMPTY,
} from './__mocks__/ghl-opportunities-fixture'

// Will be imported once Plan 03 ships:
// import { runReengagement } from '@/lib/automations/ghl-reengagement/runner'

// Reference fixtures so unused-import lint never deletes them while RED.
void FIXTURE_CREDENTIALS
void FIXTURE_LOST_OLD_PAGE_1
void FIXTURE_LOST_OLD_PAGE_2
void FIXTURE_LOST_RECENT_ONLY
void FIXTURE_EMPTY

describe('runReengagement (REENG-02, REENG-04, REENG-10, REENG-11, REENG-12)', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  // ---- Happy path ----
  it('lists Lost opportunities older than threshold and dispatches SMS to each new contact', async () => {
    // REVISED: SMS goes via sendSmsViaGhl, not Twilio.
    // Plan 03: mock listOpportunities → FIXTURE_LOST_OLD_PAGE_1 + PAGE_2 merged
    // mock sendSmsViaGhl → returns "SMS sent via GHL. ID: msg_..."
    // mock supabase claim-first insert → returns inserted row
    // assert result.processed === 5, result.sent === 5, result.failed === 0
    // (non-E.164 phone skip removed — GHL uses contactId; phone format is GHL's problem)
    expect.fail('Plan 03 must implement happy-path runner — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-04: contact field extraction ----
  it('passes contact.id and rendered body into sendSmsViaGhl params', async () => {
    // Plan 03 must call sendSmsViaGhl({ contactId: opp.contact.id, body: rendered }, ghlCreds)
    expect.fail('Plan 03 must pass contactId into sendSmsViaGhl — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-10: anti-loop skip ----
  it('skips contacts already present in ghl_reengagement_sent (anti-loop)', async () => {
    // Plan 03: seed mock supabase to have a row for ct_001
    // Assert sendSms NOT called for ct_001, called for ct_002+
    // Assert result.skipped >= 1
    expect.fail('Plan 03 must enforce anti-loop skip — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-11: insert on success ----
  it('claims the anti-loop row BEFORE sending, deletes on GHL failure (claim-first pattern)', async () => {
    // Plan 03: mock supabase insert succeeds; mock sendSmsViaGhl throws
    // Assert supabase.from('ghl_reengagement_sent').delete() is called with the just-inserted row id
    // Assert result.failed >= 1
    expect.fail('Plan 03 must implement claim-first rollback — test stub from Plan 01 Wave 0')
  })

  it('insert ON CONFLICT DO NOTHING — second concurrent run returning null row skips the dispatch', async () => {
    // Plan 03: mock the insert .select('id').single() to return { data: null } for one contact
    // Assert sendSms NOT called for that contact, result.skipped includes it
    expect.fail('Plan 03 must skip on conflict — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-12: logAction per dispatch ----
  it('calls logAction once per dispatch attempt with tool_name="ghl_reengagement_sms"', async () => {
    // Plan 03: spy on logAction module export
    // Assert logAction called N times where N === processed - skipped
    // Assert every call has payload.tool_name === 'ghl_reengagement_sms'
    // Assert payload.vapi_call_id startsWith 'cron:ghl-reengagement:'
    expect.fail('Plan 03 must log every dispatch — test stub from Plan 01 Wave 0')
  })

  it('logAction payload includes ghl_contact_id (opaque) and truncates body to 40 chars (T-32-03)', async () => {
    // REVISED: phone is no longer in dispatch params — we pass contactId.
    // Assert request_payload.ghl_contact_id === 'ct_001'
    // Assert request_payload.message_rendered_first40.length <= 40
    expect.fail('Plan 03 must log opaque contactId + truncated body — test stub from Plan 01 Wave 0')
  })

  it('logAction on GHL failure: status="error" + error_detail populated', async () => {
    expect.fail('Plan 03 must log error path — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-03 defense-in-depth ----
  it('JS-side date guard: filters out opportunities younger than threshold even if GHL returns them', async () => {
    // Plan 03: mock listOpportunities → FIXTURE_LOST_RECENT_ONLY (updatedAt within threshold)
    // Assert result.processed === 0 or result.skipped includes the recent one with reason='within_threshold'
    expect.fail('Plan 03 must defend with JS-side date filter — test stub from Plan 01 Wave 0')
  })

  // ---- Edge cases from VALIDATION.md ----
  it('empty Lost list returns { processed:0, sent:0, skipped:0, failed:0, errors:[] }', async () => {
    expect.fail('Plan 03 must handle empty case — test stub from Plan 01 Wave 0')
  })

  it('all contacts in anti-loop → processed=N, sent=0, skipped=N', async () => {
    expect.fail('Plan 03 must handle all-skipped case — test stub from Plan 01 Wave 0')
  })

  it('mixed success/failure via Promise.allSettled — one GHL fail does not block others', async () => {
    // Assert sent === 2, failed === 1, errors[0].ghl_contact_id and errors[0].error_message defined
    expect.fail('Plan 03 must use allSettled — test stub from Plan 01 Wave 0')
  })

  it('GHL returns 4xx for contact with no phone → counted as "failed" with error_detail', async () => {
    // REVISED: phone format is GHL's concern; we pass contactId. If GHL contact has no
    // phone or no SMS permission, GHL responds with 4xx — runner classifies as failed.
    // Assert sendSmsViaGhl IS called for ct_004 (no pre-validation)
    // Assert result.failed includes ct_004, errors[i].error_message includes GHL status
    expect.fail('Plan 03 must let GHL surface phone errors — test stub from Plan 01 Wave 0')
  })

  it('missing firstName → SMS body contains "amigo(a)"; dispatch succeeds', async () => {
    // ct_003 has firstName: null
    // Assert sendSmsViaGhl called for ct_003 with body containing 'amigo(a)'
    expect.fail('Plan 03 must use amigo(a) fallback in dispatch — test stub from Plan 01 Wave 0')
  })

  it('GHL 401 on first listOpportunities call → throws so route handler returns 500', async () => {
    expect.fail('Plan 03 must let GHL auth errors bubble — test stub from Plan 01 Wave 0')
  })

  it('respects batchLimit: stops dispatching after batchLimit successful sends in one run', async () => {
    expect.fail('Plan 03 must enforce batchLimit — test stub from Plan 01 Wave 0')
  })
})
