import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function AgentsPage() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure the chat agents that serve your text channels.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming online</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The agents dashboard is being assembled. Channel defaults card and agents
            table land in Plan 03; the edit form lands in Plan 04.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
