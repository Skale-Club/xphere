-- Migration 1140: allow multiple time slots per day in user_availability
-- Drop the single-slot-per-day unique constraint so operators can configure
-- e.g. "08:00-12:00 and 14:00-18:00" for the same weekday.

ALTER TABLE public.user_availability
  DROP CONSTRAINT IF EXISTS user_availability_user_id_day_of_week_key;
