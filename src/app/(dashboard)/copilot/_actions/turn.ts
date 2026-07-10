'use server'

// Blocking (non-streaming) entry point for a Copilot turn. The panel uses the
// streaming route at /api/copilot/turn; this action remains for programmatic
// callers and as a fallback. All logic lives in the shared core.

import {
  executeCopilotTurn,
  type CopilotTurnInput,
  type CopilotTurnOutput,
  type TurnResult,
} from '@/lib/copilot/execute-turn'

export type SendMessageInput = CopilotTurnInput
export type SendMessageResult = CopilotTurnOutput

export async function sendCopilotMessage(
  input: SendMessageInput,
): Promise<TurnResult<SendMessageResult>> {
  return executeCopilotTurn(input)
}
