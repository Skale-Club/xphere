-- 1329: notifications can carry 'ads_connection_expiring'.
--
-- The nightly ads-tick (src/app/api/cron/ads-tick/route.ts) now notifies an
-- org's owners/admins when an in-use ads connection is 14/7/3/1 days from
-- expiry and on the night it lapses (src/lib/ads/expiry-notify.ts). A lapsed
-- Meta token silently stops reporting, CAPI and Custom Audience syncs.
--
-- Idempotent: DROP ... IF EXISTS before ADD.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'new_conversation', 'missed_call', 'flow_failed', 'new_message', 'incoming_call',
    'handoff_requested', 'local_seo_alert', 'ads_connection_expiring'
  ));
