-- Migration 1132: add 'workflow' to the agent_channel enum.
-- Lets the workflow flow "Agent" node invoke runAgent with channel='workflow'
-- (a server-initiated, non-public channel) and persist agent_invocations.channel
-- without violating the enum. The allowed_channels gate is bypassed in code for
-- this channel, so agents don't need to opt in.

ALTER TYPE public.agent_channel ADD VALUE IF NOT EXISTS 'workflow';
