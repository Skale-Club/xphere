'use client'

import { Bot, User as UserIcon } from 'lucide-react'
import { ToolCallBlock } from './tool-call-block'
import type { CopilotMessage } from '@/stores/copilot-store'

export function MessageBubble({ message }: { message: CopilotMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Bot className="h-3.5 w-3.5" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-accent text-white'
            : 'bg-bg-secondary text-text-primary border border-border'
        }`}
      >
        {message.pending && message.parts.length === 0 && (
          <span className="text-text-tertiary italic">Thinking…</span>
        )}
        {message.parts.map((part, idx) => {
          if (part.type === 'text') {
            return (
              <p key={idx} className="whitespace-pre-wrap break-words leading-relaxed">
                {renderInlineMarkdown(part.text ?? '')}
              </p>
            )
          }
          if (part.type === 'image' && part.url) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={idx}
                src={part.url}
                alt="attachment"
                className="mt-1.5 max-w-full rounded-lg border border-white/20 object-contain"
                style={{ maxHeight: 240 }}
              />
            )
          }
          if (part.type === 'tool_call') {
            return <ToolCallBlock key={idx} part={part} />
          }
          return null
        })}
        {message.runId && (
          <div className="mt-1 text-[10px] text-text-tertiary">
            run {message.runId.slice(0, 8)}
            {typeof message.costUsd === 'number' && ` · ~$${message.costUsd.toFixed(4)}`}
          </div>
        )}
      </div>
      {isUser && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-secondary text-text-secondary">
          <UserIcon className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  )
}

// Very small markdown subset: just bold + links. We avoid pulling in
// react-markdown for v1 | the copilot system prompt keeps responses simple.
function renderInlineMarkdown(text: string): React.ReactNode {
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  const out: Array<string | React.ReactElement> = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <a key={`l${key++}`} href={m[2]} className="underline text-accent">
        {m[1]}
      </a>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
