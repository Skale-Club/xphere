import { getPlaybookSources, hasPlatformOpenRouterKey } from './_actions/playbook'
import { PlaybookManager } from '@/components/admin/ads-playbook/playbook-manager'

export const dynamic = 'force-dynamic'

export default async function AdminAdsPlaybookPage() {
  const [sources, hasKey] = await Promise.all([
    getPlaybookSources(),
    hasPlatformOpenRouterKey(),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Ads Playbook (Base Global)</h1>
        <p className="text-sm text-text-secondary mt-1">
          Conhecimento curado de fundamentos de mídia (cursos, boas práticas de mercado), por plataforma.
          A jornada de ads de qualquer organização consulta esta base — via Copilot e via MCP — para fundamentar
          diagnósticos e planos. A ingestão é cobrada na chave OpenRouter global da plataforma.
        </p>
      </div>
      <PlaybookManager
        sources={sources as Parameters<typeof PlaybookManager>[0]['sources']}
        disabled={!hasKey}
      />
    </div>
  )
}
