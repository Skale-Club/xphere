-- Add 'showed' to the bookings.status allowed values.
-- 'showed' is set automatically 2 hours after end_at by the post-service
-- mark-showed workflow, indicating the client was present for the service.

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('confirmed', 'cancelled', 'no_show', 'showed'));
