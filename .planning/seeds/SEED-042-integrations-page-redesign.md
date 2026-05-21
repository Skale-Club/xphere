---
id: SEED-042
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: high
depends_on: [SEED-031]
---

# SEED-042: Integrations Page — Redesign Completo

Unifica a página de integrações em uma lista única agrupada por categoria,
com painel lateral de configuração por integração, fluxo de teste → salvar → ativar
e arquitetura extensível para adicionar novas integrações sem código repetido.

---

## Requisitos consolidados (sessão 2026-05-20)

1. ✅ Remover seção "Channels & Dedicated" (cards no topo) — não existe mais
2. ✅ Uma lista única com todas as integrações, agrupadas por categoria
3. ✅ Clicar em qualquer integração → abre painel lateral (Sheet) de configuração
4. ✅ Painel tem campos + botão Testar → se passar → habilita Salvar
5. ✅ Salvar e Ativar são ações separadas (pode ter a key salva sem ativar)
6. ✅ Remove Anthropic da lista (OpenRouter cobre todos os modelos via OpenAI format)
7. ✅ Logo real de cada app à esquerda de cada linha
8. ✅ WhatsApp na lista = "WhatsApp"; dentro do painel → seletor de provider (Evolution Go / Z-API / W-API)
9. ✅ OpenRouter: após key validar → 3 seletores de modelo com busca em tempo real: texto, visão, voz
10. ✅ Twilio: painel com abas — Credenciais, Números, Voice SDK, SIP
11. ✅ Arquitetura extensível — nova integração = adicionar ao registry

---

## Categorias

```
Messaging      WhatsApp · Meta (Messenger + Instagram) · ManyChat
Voice & SMS    Twilio · Vapi
CRM            GoHighLevel · Google Contacts
AI             OpenRouter
Scheduling     Cal.com
Reviews        Google Reviews
```

**Removidos:** Anthropic (OpenRouter cobre Claude), OpenAI (embeddings migram para OpenRouter).
**Nota:** Se OpenAI for necessário para embeddings de conhecimento, manter como integração interna
não-visível (não aparece na lista, só usada pelo sistema).

---

## Arquitetura — Integration Registry

### `IntegrationDefinition` — o contrato de cada integração

```ts
// src/lib/integrations/registry.ts — NEW

export type IntegrationCategory =
  | 'messaging'
  | 'voice_sms'
  | 'crm'
  | 'ai'
  | 'scheduling'
  | 'reviews'

export type PanelType =
  | 'api_key'          // campo de chave + test genérico
  | 'custom'           // componente próprio (Twilio, WhatsApp, Meta)
  | 'oauth'            // fluxo OAuth (Meta, Google)

export interface IntegrationDefinition {
  id: string                          // provider key — igual ao enum integration_provider
  name: string                        // "WhatsApp", "Twilio", "OpenRouter"
  description: string
  category: IntegrationCategory
  logo: string                        // caminho em /public/logos/{id}.svg
  logoAlt?: string                    // alt text para o logo
  panelType: PanelType
  canActivate: boolean                // false = sempre ativo se salvo (ex: Google Reviews)
  testable: boolean                   // tem botão Testar antes de salvar?
  docsUrl?: string                    // link para documentação oficial
  // Para panelType='api_key': campos do formulário
  fields?: IntegrationField[]
  // Para panelType='custom': componente a renderizar no Sheet
  CustomPanel?: React.ComponentType<CustomPanelProps>
}

export interface IntegrationField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  hint?: string
  required: boolean
}

// Registry completo:
export const INTEGRATION_REGISTRY: IntegrationDefinition[] = [
  // ── Messaging ─────────────────────────────────────────────────────────────
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Conecte via Evolution Go, Z-API ou W-API para enviar e receber mensagens.',
    category: 'messaging',
    logo: '/logos/whatsapp.svg',
    panelType: 'custom',
    canActivate: true,
    testable: true,
    CustomPanel: WhatsAppPanel,
  },
  {
    id: 'meta',
    name: 'Meta Messaging',
    description: 'Messenger e Instagram DM via Facebook OAuth.',
    category: 'messaging',
    logo: '/logos/meta.svg',
    panelType: 'oauth',
    canActivate: true,
    testable: false,
    CustomPanel: MetaPanel,
  },
  {
    id: 'manychat',
    name: 'ManyChat',
    description: 'Receba eventos do ManyChat e roteie para workflows e agentes.',
    category: 'messaging',
    logo: '/logos/manychat.svg',
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'mc-...', hint: 'Encontre em ManyChat → Settings → API' },
    ],
  },

  // ── Voice & SMS ───────────────────────────────────────────────────────────
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'SMS, ligações no browser e SIP. Configure números por org.',
    category: 'voice_sms',
    logo: '/logos/twilio.svg',
    panelType: 'custom',
    canActivate: true,
    testable: true,
    CustomPanel: TwilioPanel,
  },
  {
    id: 'vapi',
    name: 'Vapi',
    description: 'Assistente de voz IA com transcrição e análise de chamadas.',
    category: 'voice_sms',
    logo: '/logos/vapi.svg',
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'vapi_...', hint: 'dashboard.vapi.ai → Account → API Keys' },
    ],
  },

  // ── CRM ───────────────────────────────────────────────────────────────────
  {
    id: 'gohighlevel',
    name: 'GoHighLevel',
    description: 'CRM e automação de marketing. SMS, contatos e agendamentos.',
    category: 'crm',
    logo: '/logos/gohighlevel.svg',
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'eyJ...' },
      { key: 'location_id', label: 'Location ID', type: 'text', required: true,
        hint: 'Settings → Business Profile → Location ID' },
    ],
  },
  {
    id: 'google_contacts',
    name: 'Google Contacts',
    description: 'Crie, atualize e sincronize contatos via Google People API.',
    category: 'crm',
    logo: '/logos/google-contacts.svg',
    panelType: 'oauth',
    canActivate: true,
    testable: false,
    CustomPanel: GoogleContactsPanel,
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Gateway multi-modelo (OpenAI format). Acessa Claude, GPT-4, Gemini e mais.',
    category: 'ai',
    logo: '/logos/openrouter.svg',
    panelType: 'custom',
    canActivate: true,
    testable: true,
    CustomPanel: OpenRouterPanel,   // inclui seletores de modelo
  },

  // ── Scheduling ───────────────────────────────────────────────────────────
  {
    id: 'calcom',
    name: 'Cal.com',
    description: 'Agendamentos online. Sincronize disponibilidade e bookings.',
    category: 'scheduling',
    logo: '/logos/calcom.svg',
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'cal_live_...', hint: 'cal.com/settings/developer/api-keys' },
    ],
  },

  // ── Reviews ───────────────────────────────────────────────────────────────
  {
    id: 'google_reviews',
    name: 'Google Reviews',
    description: 'Scraping diário das avaliações do Google Business para widget embeddável.',
    category: 'reviews',
    logo: '/logos/google.svg',
    panelType: 'custom',
    canActivate: false,   // sempre ativo se configurado
    testable: true,
    CustomPanel: GoogleReviewsPanel,
  },
]
```

---

## Página principal — `/integrations`

### Layout

```
/integrations

Integrations                                              [+ Add custom]

─── Messaging ─────────────────────────────────────────────────────────
[WA]  WhatsApp         Envio e recepção de mensagens                 ● Ativo     [→]
[MT]  Meta Messaging   Messenger e Instagram DM via OAuth            ● Conectado [→]
[MC]  ManyChat         Eventos de subscriber do ManyChat             ○ Inativo   [→]

─── Voice & SMS ───────────────────────────────────────────────────────
[TW]  Twilio           SMS + browser voice + SIP · 2 números         ● Ativo     [→]
[VP]  Vapi             Assistente de voz IA                          ● Ativo     [→]

─── CRM ───────────────────────────────────────────────────────────────
[GH]  GoHighLevel      CRM e automação                               ● Ativo     [→]
[GC]  Google Contacts  Sincronização de contatos                     ○ Não conectado [→]

─── AI ────────────────────────────────────────────────────────────────
[OR]  OpenRouter       Gateway multi-modelo (Claude, GPT-4, Gemini)  ● Ativo     [→]

─── Scheduling ────────────────────────────────────────────────────────
[CA]  Cal.com          Agendamentos online                            ○ Não conectado [→]

─── Reviews ───────────────────────────────────────────────────────────
[GG]  Google Reviews   Widget de avaliações do Google Business        ● Ativo     [→]
```

### Status pill por linha

| Estado | Pill | Condição |
|--------|------|---------|
| `Ativo` | Verde | `is_active = true` |
| `Conectado` | Verde | Salvo mas sem conceito de ativar (OAuth) |
| `Inativo` | Cinza | Salvo mas `is_active = false` |
| `Não conectado` | Cinza pontilhado | Sem credenciais |
| `Erro` | Vermelho | Último teste falhou |

### Logo de cada integração

```tsx
// src/components/integrations/integration-logo.tsx — NEW

// Logos SVG em /public/logos/
// Fallback: ícone lucide do registry

function IntegrationLogo({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  return (
    <div className="rounded-[8px] border border-border-subtle bg-bg-tertiary p-1.5 shrink-0"
         style={{ width: size, height: size }}>
      <img
        src={`/logos/${id}.svg`}
        alt={name}
        width={size - 12}
        height={size - 12}
        className="object-contain"
        onError={(e) => {
          // fallback para ícone genérico se o logo não existir
          e.currentTarget.style.display = 'none'
        }}
      />
    </div>
  )
}
```

Logos a incluir em `/public/logos/`:
`whatsapp.svg`, `meta.svg`, `manychat.svg`, `twilio.svg`, `vapi.svg`,
`gohighlevel.svg`, `google-contacts.svg`, `openrouter.svg`, `calcom.svg`, `google.svg`

---

## Painel lateral — fluxo genérico (api_key)

```tsx
// src/components/integrations/integration-panel.tsx — NEW

// Sheet lateral que funciona para qualquer integração api_key
// O mesmo componente, configurado pelo IntegrationDefinition

function IntegrationPanel({ definition, existing, onClose }: PanelProps) {
  const [fields, setFields] = useState<Record<string, string>>({})
  const [testState, setTestState] = useState<'idle' | 'testing' | 'pass' | 'fail'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isActive, setIsActive] = useState(existing?.is_active ?? false)

  // Teste desbloqueia o Save
  const canSave = testState === 'pass' || (existing?.is_active && !isDirty)

  return (
    <Sheet>
      <SheetContent className="w-full sm:max-w-[480px] flex flex-col">

        {/* Header */}
        <SheetHeader>
          <div className="flex items-center gap-3">
            <IntegrationLogo id={definition.id} name={definition.name} size={40} />
            <div>
              <SheetTitle>{definition.name}</SheetTitle>
              <p className="text-[12px] text-text-tertiary">{definition.description}</p>
            </div>
          </div>
          {definition.docsUrl && (
            <a href={definition.docsUrl} target="_blank"
               className="text-[12px] text-accent hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3" /> Documentação
            </a>
          )}
        </SheetHeader>

        {/* Campos */}
        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {definition.fields?.map(field => (
            <div key={field.key} className="space-y-1.5">
              <Label>{field.label}{field.required && <span className="text-rose-400 ml-0.5">*</span>}</Label>
              <div className="relative">
                <Input
                  type={field.type === 'password' && !showField[field.key] ? 'password' : 'text'}
                  placeholder={existing ? '••••••••• (salvo)' : field.placeholder}
                  value={fields[field.key] ?? ''}
                  onChange={(e) => {
                    setFields(prev => ({ ...prev, [field.key]: e.target.value }))
                    setTestState('idle')  // reset test ao mudar campo
                  }}
                />
                {field.type === 'password' && (
                  <button onClick={() => toggleShow(field.key)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary">
                    {showField[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {field.hint && <p className="text-[11px] text-text-tertiary">{field.hint}</p>}
            </div>
          ))}
        </div>

        {/* Resultado do teste */}
        {testState !== 'idle' && (
          <div className={cn('flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px]',
            testState === 'pass' && 'bg-success-muted/20 text-success',
            testState === 'fail' && 'bg-rose-500/10 text-rose-400',
            testState === 'testing' && 'bg-bg-tertiary text-text-tertiary',
          )}>
            {testState === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {testState === 'pass' && <Check className="h-3.5 w-3.5" />}
            {testState === 'fail' && <X className="h-3.5 w-3.5" />}
            {testMessage}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-border-subtle pt-4 space-y-3">

          {/* Activate toggle — separado do Save */}
          {definition.canActivate && existing && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-text-primary">Ativar integração</p>
                <p className="text-[11px] text-text-tertiary">
                  Integração {isActive ? 'ativa nos workflows e agentes' : 'salva mas não utilizada'}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={(v) => handleToggleActive(v)}
              />
            </div>
          )}

          <div className="flex gap-2">
            {definition.testable && (
              <Button variant="outline" onClick={handleTest} disabled={testState === 'testing'}
                      className="flex-1">
                {testState === 'testing'
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Testando...</>
                  : <><Zap className="h-3.5 w-3.5 mr-1" /> Testar</>}
              </Button>
            )}
            <Button onClick={handleSave} disabled={!canSave || isSaving}
                    className={cn('flex-1', !definition.testable && 'w-full')}>
              {isSaving
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Salvando...</>
                : <><Save className="h-3.5 w-3.5 mr-1" /> Salvar</>}
            </Button>
          </div>

          {definition.testable && testState !== 'pass' && !existing && (
            <p className="text-center text-[11px] text-text-tertiary">
              Teste a chave antes de salvar
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

---

## Painel OpenRouter — seletores de modelo

```tsx
// src/components/integrations/openrouter-panel.tsx — NEW

// Após testar a chave com sucesso, busca modelos disponíveis via OpenRouter API
// e mostra 3 seletores com busca em tempo real

function OpenRouterPanel({ existing, onClose }) {
  const [apiKey, setApiKey] = useState('')
  const [testState, setTestState] = useState<'idle'|'testing'|'pass'|'fail'>('idle')
  const [models, setModels] = useState<OpenRouterModel[]>([])

  // Após teste bem-sucedido: busca /api/openrouter/models
  async function handleTest() {
    setTestState('testing')
    const res = await testOpenRouterKey(apiKey)
    if (res.ok) {
      setTestState('pass')
      setModels(res.models)   // vem da API com capabilities por modelo
    } else {
      setTestState('fail')
    }
  }

  return (
    <>
      {/* Campo da chave */}
      <IntegrationKeyField value={apiKey} onChange={setApiKey} existing={existing} />

      {/* Seletores — só aparecem após teste passar */}
      {testState === 'pass' && (
        <div className="space-y-4 pt-2">
          <p className="text-[12px] font-medium text-text-tertiary uppercase tracking-wide">
            Modelos padrão
          </p>

          <ModelSelector
            label="Modelo de texto"
            description="Usado nos agentes de chat e workflows"
            models={models.filter(m => m.capabilities.includes('text'))}
            value={selectedText}
            onChange={setSelectedText}
          />

          <ModelSelector
            label="Modelo de visão"
            description="Análise de imagens e documentos"
            models={models.filter(m => m.capabilities.includes('vision'))}
            value={selectedVision}
            onChange={setSelectedVision}
          />

          <ModelSelector
            label="Modelo de voz (STT)"
            description="Transcrição de áudio — Whisper e similares"
            models={models.filter(m => m.capabilities.includes('audio'))}
            value={selectedAudio}
            onChange={setSelectedAudio}
          />
        </div>
      )}
    </>
  )
}

// ModelSelector com busca em tempo real
function ModelSelector({ label, description, models, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = models.filter(m =>
    m.name.toLowerCase().includes(query.toLowerCase()) ||
    m.id.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <p className="text-[11px] text-text-tertiary">{description}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between text-left font-normal">
            {value ? models.find(m => m.id === value)?.name : 'Selecionar modelo...'}
            <ChevronsUpDown className="h-3.5 w-3.5 text-text-tertiary" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[380px] p-0">
          {/* Busca em tempo real */}
          <div className="flex items-center border-b border-border-subtle px-3">
            <Search className="h-3.5 w-3.5 text-text-tertiary mr-2 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar modelo..."
              className="flex-1 py-2.5 text-[13px] bg-transparent outline-none placeholder:text-text-tertiary"
            />
          </div>
          <ScrollArea className="max-h-[240px]">
            {filtered.length === 0 ? (
              <p className="text-center text-[12px] text-text-tertiary py-4">Nenhum resultado</p>
            ) : (
              filtered.map(model => (
                <button key={model.id}
                        onClick={() => { onChange(model.id); setOpen(false); setQuery('') }}
                        className={cn('w-full text-left px-3 py-2 text-[13px] hover:bg-bg-tertiary',
                          value === model.id && 'bg-accent-muted/30 text-accent')}>
                  <p className="font-medium">{model.name}</p>
                  <p className="text-[11px] text-text-tertiary">{model.id}</p>
                </button>
              ))
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
```

---

## Painel WhatsApp — provider selector

```tsx
// src/components/integrations/whatsapp-panel.tsx — NEW

// Dentro do painel "WhatsApp", seletor de provider (alinhado com SEED-031):

function WhatsAppPanel({ existing, onClose }) {
  const [provider, setProvider] = useState<'evolution'|'zapi'|'wapi'>(
    existing?.provider ?? 'evolution'
  )

  return (
    <>
      {/* Seletor de provider */}
      <div className="space-y-2">
        <Label>Provider</Label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'evolution', label: 'Evolution Go', hint: 'Self-hosted' },
            { id: 'zapi', label: 'Z-API', hint: 'Cloud' },
            { id: 'wapi', label: 'W-API', hint: 'Cloud' },
          ].map(p => (
            <button key={p.id}
                    onClick={() => setProvider(p.id as any)}
                    className={cn('rounded-[8px] border p-2.5 text-left transition-colors',
                      provider === p.id
                        ? 'border-accent bg-accent-muted/20 text-text-primary'
                        : 'border-border-subtle text-text-secondary hover:border-border-strong')}>
              <p className="text-[12.5px] font-medium">{p.label}</p>
              <p className="text-[10.5px] text-text-tertiary">{p.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Campos específicos do provider selecionado */}
      {provider === 'evolution' && <EvolutionFields existing={existing} />}
      {provider === 'zapi' && <ZApiFields existing={existing} />}
      {provider === 'wapi' && <WApiFields existing={existing} />}
    </>
  )
}
```

---

## Painel Twilio — abas

```tsx
// src/components/integrations/twilio-panel.tsx — NEW (extrai de twilio-settings.tsx)

function TwilioPanel({ existing, onClose }) {
  const [tab, setTab] = useState<'credentials'|'numbers'|'voice_sdk'|'sip'>('credentials')

  return (
    <>
      {/* Tabs */}
      <div className="flex border-b border-border-subtle -mx-6 px-6">
        {[
          { id: 'credentials', label: 'Credenciais' },
          { id: 'numbers', label: 'Números' },
          { id: 'voice_sdk', label: 'Voice SDK' },
          { id: 'sip', label: 'SIP' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
                  className={cn('px-3 py-2.5 text-[13px] border-b-2 -mb-px transition-colors',
                    tab === t.id
                      ? 'border-accent text-text-primary font-medium'
                      : 'border-transparent text-text-tertiary hover:text-text-primary')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo por aba */}
      {tab === 'credentials' && <TwilioCredentialsTab existing={existing} />}
      {tab === 'numbers' && <TwilioNumbersTab />}
      {tab === 'voice_sdk' && <TwilioVoiceSDKTab existing={existing} />}
      {tab === 'sip' && <TwilioSIPTab existing={existing} />}
    </>
  )
}
```

---

## Remoção de Anthropic

```ts
// src/lib/agents/models.ts — EDIT
// Remover entradas Anthropic diretas
// Manter os modelos mas via OpenRouter:

export const AVAILABLE_MODELS = [
  'anthropic/claude-sonnet-4-6',   // via OpenRouter
  'anthropic/claude-opus-4-7',     // via OpenRouter
  'anthropic/claude-haiku-4-5',    // via OpenRouter
  'openai/gpt-4o',                 // via OpenRouter
  'openai/gpt-4o-mini',            // via OpenRouter
  'google/gemini-2.5-pro',         // via OpenRouter
  'google/gemini-2.5-flash',       // via OpenRouter
] as const

// Nota: todos esses modelos são acessados via OpenRouter (formato OpenAI)
// A integração direta com Anthropic é removida da lista de integrações
// mas os modelos Claude continuam disponíveis via OpenRouter
```

```ts
// src/components/integrations/integrations-table.tsx — EDIT
// Remover 'anthropic' de ALL_PROVIDERS
// A lista será substituída pelo INTEGRATION_REGISTRY
```

---

## Arquivos

```
src/lib/integrations/
└── registry.ts                              NEW: IntegrationDefinition + INTEGRATION_REGISTRY

src/app/(dashboard)/integrations/
└── page.tsx                                 EDIT: remove seção cards, usa lista unificada por categoria

src/components/integrations/
├── integrations-list.tsx                    NEW: lista agrupada por categoria (substitui integrations-table)
├── integration-row.tsx                      NEW: linha com logo + nome + status + arrow
├── integration-logo.tsx                     NEW: <img> com fallback
├── integration-panel.tsx                    NEW: Sheet genérico para api_key providers
├── openrouter-panel.tsx                     NEW: painel com seletores de modelo
├── whatsapp-panel.tsx                       NEW: painel com provider selector (SEED-031)
├── twilio-panel.tsx                         NEW: painel com abas (extrai de twilio-settings.tsx)
├── meta-panel.tsx                           NEW: OAuth panel (extrai de meta settings)
├── google-contacts-panel.tsx               NEW: OAuth panel
├── google-reviews-panel.tsx                NEW: panel inline
├── integrations-table.tsx                  DELETE (substituído)
└── twilio-settings.tsx                     DEPRECATED → internals migram para twilio-panel.tsx

public/logos/
├── whatsapp.svg
├── meta.svg
├── manychat.svg
├── twilio.svg
├── vapi.svg
├── gohighlevel.svg
├── google-contacts.svg
├── openrouter.svg
├── calcom.svg
└── google.svg

src/lib/agents/models.ts                     EDIT: remover Anthropic como provider direto
src/app/api/openrouter/models/route.ts       NEW: proxy para GET openrouter.ai/api/v1/models
```

---

## Adicionar nova integração no futuro

```ts
// Basta adicionar ao INTEGRATION_REGISTRY:
{
  id: 'slack',
  name: 'Slack',
  description: 'Envie notificações para canais do Slack via workflows.',
  category: 'messaging',
  logo: '/logos/slack.svg',
  panelType: 'api_key',
  canActivate: true,
  testable: true,
  fields: [
    { key: 'webhook_url', label: 'Webhook URL', type: 'url', required: true },
  ],
},
// Pronto. A página e o painel são gerados automaticamente.
```

---

## Critérios de sucesso

1. ✅ Página não tem mais seção "Channels & Dedicated" com cards
2. ✅ Uma lista única com todas as integrações agrupadas por categoria
3. ✅ Logo real de cada app visível à esquerda de cada linha
4. ✅ Clicar em qualquer linha abre Sheet lateral de configuração
5. ✅ Painel tem botão Testar → resultado → Save só habilitado após teste passar
6. ✅ Switch de Ativar/Desativar separado do Save
7. ✅ Anthropic não aparece na lista; modelos Claude disponíveis via OpenRouter
8. ✅ WhatsApp na lista = "WhatsApp"; dentro do painel há seletor Evolution Go / Z-API / W-API
9. ✅ OpenRouter: após validar key → 3 seletores com busca em tempo real por capacidade
10. ✅ Twilio: painel com 4 abas (Credenciais, Números, Voice SDK, SIP)
11. ✅ Nova integração = adicionar ao INTEGRATION_REGISTRY, sem código extra
12. ✅ `npm run build` passa sem erros de tipo
