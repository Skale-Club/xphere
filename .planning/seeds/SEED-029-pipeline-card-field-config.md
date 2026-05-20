---
id: SEED-029
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Small-Medium
priority: medium
depends_on: []
---

# SEED-029: Pipeline Card Field Configuration

Permite que o usuário configure quais campos aparecem em cada card do kanban, e em que ordem — por pipeline. A configuração fica em uma aba "Card Layout" dentro de `/pipeline/settings`.

---

## Motivação

O card atual é fixo:
```
[Avatar] Título         [···]
         Contato
         Valor          [Xd]
```

Há dados relevantes que o usuário pode querer ver sem abrir a sheet:
- Data de fechamento esperada
- Tags (chip colorido)
- Empresa do contato
- Status (won/lost badge)
- Campo customizado (ex: "Produto", "Origem")

Cada pipeline tem um público diferente: vendas quer ver valor + close date, suporte quer ver empresa + status. A configuração precisa ser **por pipeline**.

---

## Modelo de dados

### Migração 091 — coluna `card_fields` em `pipelines`

```sql
ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS card_fields jsonb NOT NULL DEFAULT '["contact_name","value","days_in_stage"]'::jsonb;
```

Formato do valor:
```json
["contact_name", "value", "days_in_stage", "expected_close_date", "tags"]
```

- Array de strings com os **field keys** ativos, na ordem de exibição
- Campos não listados ficam ocultos
- Custom fields: `"custom::{field_id}"` (ex: `"custom::abc123"`)

### Fields disponíveis (toggleable)

| Key | Label | Descrição |
|-----|-------|-----------|
| `contact_name` | Contato | Nome/telefone do contato vinculado |
| `value` | Valor | Valor monetário formatado |
| `days_in_stage` | Tempo no stage | Pill colorido com dias no estágio atual |
| `expected_close_date` | Previsão de fechamento | Data formatada em relativo ("em 3 dias") |
| `tags` | Tags | Chips coloridos (max 3, depois "+N") |
| `company` | Empresa | Nome da empresa do contato |
| `status` | Status | Badge won/lost (só se não estiver em stage won/lost) |
| `assigned_to` | Responsável | Avatar/initials do responsável |
| `custom::{id}` | Campo customizado | Valor do campo customizado do tipo opportunity |

### Campos fixos (sempre visíveis, não configuráveis)

- **Avatar do contato** (canto esquerdo) — identidade visual
- **Título** da oportunidade — conteúdo principal
- **Menu ···** (hover) — ações rápidas

---

## UI — Aba "Card Layout" em `/pipeline/settings`

### Localização

Nova aba dentro de `PipelineSettingsClient`, ao lado de "Stages":

```
Tabs: [Stages] [Card Layout]
```

### Layout da aba

```
┌─────────────────────────────────────────────────────┐
│  Card Layout                                        │
│  Configure which fields appear on kanban cards.     │
│                                              [Save] │
├────────────────────────────────┬────────────────────┤
│  Fields                        │  Preview           │
│                                │                    │
│  ☑ [≡] Contato                │  ┌──────────────┐  │
│  ☑ [≡] Valor                  │  │ [AV] Título… │  │
│  ☑ [≡] Tempo no stage         │  │      Contato │  │
│  ☐ [≡] Previsão fechamento    │  │  R$ 5.000  3d│  │
│  ☐ [≡] Tags                   │  └──────────────┘  │
│  ☐ [≡] Empresa                │                    │
│  ☐ [≡] Status                 │  (atualiza live)   │
│  ☐ [≡] Responsável            │                    │
│  ─────────────────────        │                    │
│  Campos customizados:          │                    │
│  ☐ [≡] Produto                │                    │
│  ☐ [≡] Origem                 │                    │
└────────────────────────────────┴────────────────────┘
```

- Toggle (checkbox/switch) à esquerda — liga/desliga o campo
- Handle de drag `≡` — reordena campos ativos
- Preview ao vivo à direita — card mockado com dados fictícios
- Botão Save envia ao server action → atualiza `card_fields` em `pipelines`
- Campos customizados aparecem em seção separada abaixo dos built-ins

### Interação de drag

Usar `@dnd-kit/sortable` (já instalado). Só os campos **ativos** (checked) participam do sort — unchecked fica na lista mas não tem handle ativo. Ao desmarcar um campo, ele sai da ordem mas não é deletado da lista de opções.

---

## Componentes

```
src/components/pipeline/
├── card-layout-tab.tsx         NEW: aba de configuração com drag + preview
│   ├── FieldRow                  sub: linha com toggle + drag handle
│   └── CardPreview               sub: card mockado mostrando campos ativos
├── opportunity-card.tsx        EDIT: aceita `visibleFields: string[]` prop
├── kanban-board.tsx            EDIT: passa `pipeline.card_fields` para o card
└── pipeline-settings-client.tsx  EDIT: adiciona tab "Card Layout"

src/app/(dashboard)/pipeline/
├── actions.ts                  EDIT: updatePipelineCardFields() server action
└── settings/page.tsx           EDIT: busca pipeline com card_fields

supabase/migrations/
└── 091_pipeline_card_fields.sql   NEW
```

---

## OpportunityCard — renderização condicional

```tsx
interface OpportunityCardProps {
  opportunity: OpportunityWithContact
  visibleFields: string[]   // NEW: vem do pipeline.card_fields
  onOpen: (id: string) => void
  onAction: (action: ..., id: string) => void
  isOverlay?: boolean
}

// Dentro do card, cada campo verifica:
{visibleFields.includes('contact_name') && (
  <div className="mt-0.5 text-[11.5px] text-text-tertiary truncate">{contactName}</div>
)}

{(visibleFields.includes('value') || visibleFields.includes('days_in_stage')) && (
  <div className="mt-2.5 flex items-center justify-between gap-2">
    {visibleFields.includes('value') && <span>{formatCurrency(...)}</span>}
    {visibleFields.includes('days_in_stage') && <span className={...}>{days}d</span>}
  </div>
)}

{visibleFields.includes('expected_close_date') && opp.expected_close_date && (
  <div className="mt-1.5 flex items-center gap-1 text-[11px] text-text-tertiary">
    <CalendarDays className="h-3 w-3" />
    {relativeDate(opp.expected_close_date)}
  </div>
)}

{visibleFields.includes('tags') && opp.tags?.length > 0 && (
  <div className="mt-1.5 flex flex-wrap gap-1">
    {opp.tags.slice(0, 3).map(t => <TagChip key={t.id} tag={t} />)}
    {opp.tags.length > 3 && <span>+{opp.tags.length - 3}</span>}
  </div>
)}
```

### Ordem de renderização no card

Campos são renderizados na ordem em que aparecem em `visibleFields`. O array é a source of truth tanto para visibilidade quanto para ordem.

---

## Server action — `updatePipelineCardFields`

```ts
export async function updatePipelineCardFields(
  pipelineId: string,
  fields: string[],
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('pipelines')
    .update({ card_fields: fields, updated_at: new Date().toISOString() })
    .eq('id', pipelineId)
  if (error) return { error: error.message }
  revalidatePath('/pipeline')
  revalidatePath('/pipeline/settings')
}
```

---

## Migração SQL

```sql
-- 091_pipeline_card_fields.sql
ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS card_fields jsonb
    NOT NULL
    DEFAULT '["contact_name","value","days_in_stage"]'::jsonb;

COMMENT ON COLUMN pipelines.card_fields IS
  'Ordered array of field keys visible on kanban cards. Built-in keys: contact_name, value, days_in_stage, expected_close_date, tags, company, status, assigned_to. Custom fields: "custom::{id}".';
```

---

## Critérios de sucesso

1. ✅ Aba "Card Layout" aparece em `/pipeline/settings` sem quebrar "Stages"
2. ✅ Toggle liga/desliga campo com preview ao vivo
3. ✅ Drag reordena campos ativos, preview atualiza em tempo real
4. ✅ Save persiste em `pipelines.card_fields`
5. ✅ Kanban reflete config imediatamente após refresh
6. ✅ Campo customizado do tipo `opportunity` aparece na lista
7. ✅ Card com todos os campos ativos não ultrapassa altura razoável (~140px)
8. ✅ Default preserva comportamento atual: `["contact_name","value","days_in_stage"]`
9. ✅ `npm run build` passa sem erros de tipo
