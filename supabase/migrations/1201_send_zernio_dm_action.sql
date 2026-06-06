-- Add send_zernio_dm to action_type enum.
-- Used by the Comment-to-DM workflow node (emits a private Instagram/Facebook
-- DM to the author of a comment, triggered by event:comment.received).

ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'send_zernio_dm';
