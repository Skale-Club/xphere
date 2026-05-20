-- 098_action_type_telegram.sql
-- Adds send_telegram_notification to the action_type enum so the
-- telegram executor (SEED-034) can be dispatched via execute-action.ts.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'send_telegram_notification'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'action_type')
  ) THEN
    ALTER TYPE action_type ADD VALUE 'send_telegram_notification';
  END IF;
END$$;
