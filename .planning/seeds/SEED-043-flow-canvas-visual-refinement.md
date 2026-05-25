---
id: SEED-043
status: complete
planted: 2026-05-21
planted_during: post-SEED-042 (integrations redesign just shipped, all complete seeds wired in audit)
shipped: 2026-05-25
trigger_when: now (autonomous execution requested by user)
scope: Large
priority: high
depends_on: [SEED-019, SEED-025]
phases_shipped: [identity, edges, toolbar, empty_state, palette_polish]
phases_pending: []
last_commit: 240ea3f
---

# SEED-043: Flow Canvas Visual Refinement — Caminho A

Refina visualmente o editor de workflows (ReactFlow) sem trocar o paradigma. Hoje o canvas funciona mas parece "ReactFlow padrão com tema escuro" — sem identidade do produto, sem feedback visual rico, sem polimento. Esta seed entrega o caminho A do refinamento (mantém DnD livre, melhora tudo ao redor).

---

## Estado atual (Auditoria 2026-05-21)

### O que existe e funciona

| Componente | Estado |
|-----------|--------|
| `flow-canvas.tsx` — ReactFlowProvider + canvas + sidebars | ✅ |
| `nodes/base-node.tsx` — wrapper visual reutilizável | ✅ |
| `nodes/index.tsx` — registra TriggerNode, ActionNode, ConditionNode, WaitNode, AgentNode | ✅ |
| `flow-palette.tsx` — drag source de nós | ✅ |
| `node-config-panel.tsx` — sidebar direita com form de config | ✅ |
| `flow-toolbar.tsx` — toolbar superior (nome do workflow, save, etc.) | ✅ |
| `ai-builder-chat.tsx` — chat lateral do Copilot | ✅ |
| Controls + MiniMap (já reposicionados `bottom: 80`) | ✅ |
| Zoom indicator clicável (commit `325418e`) | ✅ |

### Onde está pobre

| Problema | Impacto |
|----------|---------|
| Todos os nós Trigger usam mesmo ícone Zap + amber genérico | Visualmente indistinguível qual evento dispara |
| Todos os nós Action usam mesmo ícone Play + indigo genérico | "Send SMS" e "Create contact" parecem o mesmo nó |
| Nenhum logo de integração (Twilio, Cal.com, OpenAI, ManyChat, etc.) | Falta identidade do produto e contexto rápido |
| Edges são linhas finas cinzas, sem direção | Difícil seguir o fluxo em workflows grandes |
| Nenhum feedback visual de "nó incompleto" (config faltando) | User só descobre erro na hora de salvar |
| Nenhum feedback de "nó com erro" pós-execução | Logs de erro vivem em página separada |
| Controls + MiniMap + Zoom são 3 elementos separados, soltos no canto | Visual desorganizado, ocupa espaço |
| Workflow vazio mostra canvas em branco | Zero onboarding, user não sabe por onde começar |
| Drag-from-palette: o "fantasma" do nó é só uma silhueta | Não dá pra prever onde vai cair |
| Soltar perto de uma edge não insere o nó no meio dela | Tem que conectar manualmente depois |

---

## Plano por fases

### Fase 1 — Identidade visual dos nós

Maior impacto percebido. Cada `action_type` ou `event_type` mapeia para:
1. **Ícone real da integração** (logo SVG em `/public/logos/`, mesmo set do SEED-042)
2. **Cor da integração** (Twilio = vermelho, OpenAI = preto/branco, Cal.com = preto, etc.) substituindo a cor genérica do tipo de nó
3. **Título dinâmico** — nome legível do action ("Send SMS" em vez de `send_sms`)
4. **Subtitle de contexto** — primeira frase da config (ex: SMS → primeiro 40 chars do template; Action genérica → integration name)
5. **Estado incompleto** — borda dashed amarela quando configs obrigatórias faltam, com pequeno `AlertCircle` no canto
6. **Estado erro** — borda vermelha sólida + ícone `XCircle` se o último run falhou
7. **Estado disabled** — opacidade 60% se `workflow.is_active = false` ou `health_blocked = true`

Arquivos:
- `src/components/flows/nodes/base-node.tsx` (props extras: logo, integrationColor, state)
- `src/components/flows/nodes/index.tsx` (resolver de logo/cor/title via `getActionMetadata`/`getTriggerMetadata`)
- `src/lib/flows/node-metadata.ts` (extender com `logo` e `color` por integration)
- `public/logos/*.svg` (já existem da SEED-042)

### Fase 2 — Edges e conexões

1. **Setas direcionais** — usar `markerEnd: { type: MarkerType.ArrowClosed }` no `defaultEdgeOptions`
2. **Cor da edge segue a cor do nó de origem** (Trigger amber → edge amber por 50%, Action indigo → edge indigo, etc.)
3. **Hover na edge** revela botão `×` para deletar (já é nativo no ReactFlow, só ativar)
4. **Animação no flow ativo** — quando workflow está rodando, edges animadas (`animated: true` via realtime)
5. **Labels de branch melhores** — chips coloridos (`true` = verde-muted, `false` = rose-muted) em vez do texto simples atual
6. **Connection line preview** — linha pontilhada durante o drag de criar conexão

Arquivos:
- `src/components/flows/flow-canvas.tsx` (defaultEdgeOptions + connectionLineStyle)
- `src/components/flows/nodes/base-node.tsx` (custom edges para branch outputs)

### Fase 3 — Toolbar e cromo unificado

Substituir os 3 elementos soltos (Controls, ZoomIndicator, MiniMap) por **uma toolbar coesa**:

```
                                              ┌──────────────────────────┐
                                              │ [+] [−] [⊡] | 100% | [🗺] │  ← pílula única
                                              └──────────────────────────┘
                                                                bottom: 80, right: 16
```

- Pílula horizontal alinhada bottom-right
- Botões `+` zoom in, `−` zoom out, `⊡` fit-view
- Separador vertical
- Chip de zoom (clicável = reset 100%)
- Botão `🗺` toggle do MiniMap (esconder por default em workflows pequenos)
- **MiniMap** vira popover anchored no botão quando aberto (não fica permanentemente visível)
- Adicionar botão `📐` Auto-layout (usa `dagre` para organizar nós em árvore)
- Adicionar botão `?` que abre overlay de atalhos de teclado

Arquivos:
- `src/components/flows/canvas-toolbar.tsx` (NOVO — substitui Controls + ZoomIndicator + MiniMap inline)
- `src/components/flows/flow-canvas.tsx` (remove Controls/MiniMap, monta o novo CanvasToolbar)
- Dependência: `dagre` (npm install dagre @types/dagre) para auto-layout

### Fase 4 — Empty state com trigger picker

Quando `nodes.length === 0`:

```
        ┌──────────────────────────────────────┐
        │                                      │
        │         ⚡ What triggers this?       │
        │                                      │
        │   ┌─────────┐ ┌─────────┐ ┌────────┐│
        │   │ Manual  │ │Schedule │ │ Event  ││
        │   └─────────┘ └─────────┘ └────────┘│
        │   ┌─────────┐ ┌─────────┐            │
        │   │Tool call│ │ Webhook │            │
        │   └─────────┘ └─────────┘            │
        │                                      │
        └──────────────────────────────────────┘
```

- Card central com 5 cards clicáveis (1 por trigger_type)
- Click em qualquer um → cria o trigger node automaticamente com defaults
- Após criar trigger: o card transforma em "Now, what should happen?" com top 8 actions sugeridas

Arquivos:
- `src/components/flows/empty-canvas-state.tsx` (NOVO)
- `src/components/flows/flow-canvas.tsx` (renderiza condicionalmente)

### Fase 5 — Drag-from-palette polish

1. **Preview real do nó** durante drag (não silhueta) — usar React DragImage com snapshot do BaseNode
2. **Highlight drop zones** — cada edge existente mostra um `+` no meio quando drag está ativo
3. **Drop on edge = insert** — soltar nó perto de uma edge desconecta os dois nós e insere o novo no meio (com 2 edges automáticas)
4. **Snap-to-grid** opcional (toggle no canvas-toolbar) — alinha nós em grid de 16px

Arquivos:
- `src/components/flows/flow-palette.tsx` (preview real do nó)
- `src/components/flows/flow-canvas.tsx` (handler de drop em edge)

---

## Critérios de sucesso

1. ✅ Cada nó Action mostra logo real da integração quando aplicável (Twilio, OpenAI, Cal.com, etc.)
2. ✅ Estados visuais distintos: completo (default), incompleto (dashed amarelo), erro (vermelho), disabled (opacity)
3. ✅ Edges têm seta direcional e cor segue o nó de origem
4. ✅ Controls + Zoom + MiniMap consolidados em uma toolbar única no canto
5. ✅ Botão Auto-layout funciona com dagre
6. ✅ Empty state mostra trigger picker — user nunca vê canvas em branco
7. ✅ Drop em edge insere o nó no meio do fluxo
8. ✅ `npm run build` passa sem erros de tipo
9. ✅ Visual coerente com o resto do dashboard (Linear/Notion vibes, não ReactFlow default)

---

## Breadcrumbs

Arquivos do canvas atual:
- `src/components/flows/flow-canvas.tsx` — orchestrator
- `src/components/flows/nodes/base-node.tsx` — wrapper visual
- `src/components/flows/nodes/index.tsx` — registry de tipos
- `src/components/flows/flow-palette.tsx` — drag source
- `src/components/flows/flow-toolbar.tsx` — toolbar superior
- `src/components/flows/node-config-panel.tsx` — sidebar de config
- `src/lib/flows/node-metadata.ts` — labels/descrições por action_type
- `src/lib/flows/schema.ts` — Zod das definições

Seeds relacionadas:
- SEED-019 (Visual Automation Builder — base do canvas)
- SEED-025 (Unified Workflow System — modelo de dados)
- SEED-042 (Integrations Page Redesign — logos SVG já existem em `/public/logos/`)

---

## Notes

- Caminho A escolhido sobre Caminho B (step list à la Notion/n8n) porque o produto já tem usuários acostumados com canvas e o switch quebraria fluxos existentes
- Caminho B fica como possível SEED futuro se métricas mostrarem que usuários novos têm dificuldade
- Auto-layout via dagre é o trade-off mais conservador (já validado em outros editores ReactFlow); alternativas (elkjs, força-direcionada) podem entrar em fase posterior
