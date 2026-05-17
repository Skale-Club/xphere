import { Bot } from 'lucide-react'
import { EmptyState } from './empty-state'

export function EmptyAgents() {
  return (
    <EmptyState
      icon={Bot}
      title="No agents yet"
      description="Agents are AI workers that handle conversations, calls, and tasks autonomously. Create your first agent to get started."
      action={{ label: 'Create agent', href: '/agents/new' }}
    />
  )
}
