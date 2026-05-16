type Props = { params: Promise<{ id: string }> }

export default async function EditAgentPage({ params }: Props) {
  const { id } = await params
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Edit agent</h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        Editing agent <code className="font-mono">{id}</code>. Form arrives in Plan 04.
      </p>
    </div>
  )
}
