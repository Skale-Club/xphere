// SYNC-04: the dead location-type preference control has been removed
// from customer-facing configuration. Nothing in the booking-creation
// path ever read calendar_profiles' now-dead per-org default location
// setting (grep-confirmed in 130-RESEARCH.md) — the control promised
// automatic Google Meet link generation and similar per-option behavior
// that never happened. The column and any previously-saved value are
// left untouched (D-02); this is a UI-only removal. Per-event-type
// meeting locations are configured on the event type itself (Calendar →
// Event Types → Allowed meeting locations, added in a companion plan
// for this phase).

export function MeetingPreferences() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary">User preferences</h2>
        <p className="mt-1 text-[12.5px] text-text-tertiary">
          Set your preferences for your account.
        </p>
      </div>

      <div className="rounded-[14px] border border-border bg-bg-secondary px-5 py-6 text-center">
        <p className="text-[12.5px] text-text-tertiary">
          No account-level scheduling preferences to configure yet. Meeting
          locations are configured per event type under{' '}
          <span className="text-text-secondary">Calendar → Event Types</span>.
        </p>
      </div>
    </div>
  )
}
