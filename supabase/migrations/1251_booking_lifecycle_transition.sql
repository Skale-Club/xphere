-- =============================================================================
-- Migration 1251: Canonical Booking Lifecycle Transition RPC (LIFE-01)
--
-- Atomic guard+write for booking status transitions, replacing the two-round-
-- trip SELECT-then-UPDATE pattern in src/lib/calendar/transition.ts with a
-- single SECURITY DEFINER RPC (precedent: public.debit_copilot_credits,
-- migration 1208).
--
-- Enforces, in one transaction:
--   1. The booking exists.
--   2. The booking's org_id matches the caller-supplied p_org_id (defense in
--      depth -- this function is SECURITY DEFINER and bypasses bookings' RLS
--      policies, so the tenant boundary must be re-checked explicitly here
--      rather than relying on RLS this function does not run under).
--   3. The requested transition is either idempotent (current status already
--      equals the target -- returns transitioned:false, no error) or legal
--      per the caller-supplied p_allowed_from list (raises illegal_transition
--      otherwise -- never a silent no-op that still lets the caller emit).
--
-- Idempotent migration: safe to re-run (CREATE OR REPLACE FUNCTION).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.transition_booking_status(
  p_booking_id uuid,
  p_org_id uuid,
  p_new_status text,
  p_allowed_from text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current text;
  v_org_id uuid;
BEGIN
  IF p_new_status NOT IN ('confirmed', 'cancelled', 'no_show', 'showed') THEN
    RAISE EXCEPTION 'invalid target status: %', p_new_status;
  END IF;

  SELECT status, org_id INTO v_current, v_org_id
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  -- Tenant boundary re-check -- SECURITY DEFINER bypasses RLS, so this must
  -- not trust the caller already scoped the row. Same error as "not found"
  -- so a cross-org booking_id probe cannot distinguish the two cases.
  IF v_org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF v_current = p_new_status THEN
    RETURN jsonb_build_object(
      'transitioned', false,
      'old_status', v_current,
      'new_status', v_current
    );
  END IF;

  IF NOT (v_current = ANY(p_allowed_from)) THEN
    RAISE EXCEPTION 'illegal_transition: cannot go from % to %', v_current, p_new_status;
  END IF;

  UPDATE public.bookings
    SET status = p_new_status, updated_at = now()
    WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'transitioned', true,
    'old_status', v_current,
    'new_status', p_new_status
  );
END $$;

-- Lock down to trusted backend code only, mirroring migration 1208's wallet RPCs.
REVOKE ALL ON FUNCTION public.transition_booking_status(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_booking_status(uuid, uuid, text, text[]) TO service_role;

-- =============================================================================
-- Footer
--   transition_booking_status -- atomic guard+write for bookings.status
--     transitions. Callers: src/lib/calendar/transition.ts's confirmBooking/
--     cancelBooking/markNoShow/markShowed (all four call this RPC with
--     p_allowed_from = ARRAY['confirmed'] -- every non-idempotent transition
--     in this state machine originates from 'confirmed'; cancelled/no_show/
--     showed are terminal). rescheduleBooking does NOT use this RPC (it does
--     not change status) -- it keeps a SELECT + guarded UPDATE...WHERE
--     status='confirmed' pattern, mirroring the existing safe precedent in
--     cancelBookingByToken (src/app/(dashboard)/calendar/_actions/bookings.ts).
-- =============================================================================
