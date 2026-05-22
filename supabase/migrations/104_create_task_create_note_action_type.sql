-- SEED-046: Add create_task and create_note to action_type enum
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'create_task';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'create_note';
