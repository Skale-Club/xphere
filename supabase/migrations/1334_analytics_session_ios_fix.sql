-- =============================================================================
-- Migration 1334: correct device, browser and OS on sessions recorded with the
-- old tracking-script detection (BS-ANALYTICS-001).
--
-- The script tested "Mac OS" before "iPhone", so every iPhone and iPod
-- ("... like Mac OS X") was stored as os = 'macOS', and Chrome, Firefox and Edge
-- on iOS (CriOS / FxiOS / EdgiOS) as browser = 'Safari'. The script is fixed in
-- the same release; this rewrites the rows already stored, for every
-- organization, using only the user agent kept on the session. iPads that send
-- the desktop "Macintosh" user agent cannot be told apart afterwards and stay
-- as they are. Idempotent: a second run changes nothing.
-- =============================================================================

UPDATE public.analytics_sessions
SET os = 'iOS'
WHERE os = 'macOS'
  AND client_user_agent ~ '(iPhone|iPad|iPod)';

UPDATE public.analytics_sessions
SET device_type = 'tablet'
WHERE device_type <> 'tablet'
  AND client_user_agent ~ 'iPad';

UPDATE public.analytics_sessions
SET browser = CASE
    WHEN client_user_agent ~ 'EdgiOS/' THEN 'Edge'
    WHEN client_user_agent ~ 'FxiOS/'  THEN 'Firefox'
    ELSE 'Chrome'
  END
WHERE browser = 'Safari'
  AND client_user_agent ~ '(CriOS|FxiOS|EdgiOS)/';
