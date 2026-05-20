---
id: SEED-040
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: high
depends_on: [SEED-039]
---

# SEED-040: Chat Mobile — UX Nativa Completa

Refaz toda a experiência do chat/inbox para mobile com interações nativas:
safe areas, teclado virtual, gestos de swipe, ações por toque, navegação
contextual e todos os controles da versão desktop presentes e acessíveis.

---

## Diagnóstico atual (Auditoria 2026-05-20)

### O que funciona

| Feature | Status |
|---------|--------|
| Drawer pattern: lista → chat → painel de contato | ✅ |
| Botão back no chat header | ✅ |
| Bubbles de mensagem com max-width responsivo | ✅ |
| Contact panel abre como sheet mobile | ✅ |
| Composer com textarea auto-resize | ✅ |

### O que está quebrado ou faltando

| Problema | Impacto |
|---------|---------|
| Sem `viewport-fit=cover` — conteúdo esconde atrás do notch | Sério no iPhone |
| Sem `env(safe-area-inset-*)` no header e composer | Botões ocultos atrás da barra do iPhone |
| Sem keyboard avoidance — composer some sob o teclado | Impossível digitar no iOS |
| Ações de card (pin, menu) são hover-only — invisíveis no touch | Usuário não consegue arquivar/fixar |
| Nenhum gesto de swipe em lugar nenhum | Navegação 100% por botões |
| Toasts em `bottom-right` sobrepõe composer no mobile | UX quebrada |
| `⌘K` hint visível no mobile | Nonsense em touch |
| Painel de contato sem transição de entrada | Aparece bruscamente |
| Filtros avançados inacessíveis no mobile | Feature invisível |
| Bot toggle, priority, status — enterrados em menu | Ações principais difíceis de acessar |
| Sem "pull to refresh" na lista de conversas | Padrão nativo ausente |
| Sem feedback háptico | App parece web, não nativo |

---

## Fundação — Viewport e Safe Areas

### 1A — Viewport metadata correto

```ts
// src/app/layout.tsx — EDIT
import type { Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,           // permite zoom de acessibilidade
  userScalable: true,
  viewportFit: 'cover',      // cobre o notch do iPhone
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0A0A0F' },
    { media: '(prefers-color-scheme: light)', color: '#F5F5F7' },
  ],
}
```

### 1B — CSS safe areas global

```css
/* src/app/globals.css — EDIT */

/* Utilitários de safe area */
.pb-safe { padding-bottom: env(safe-area-inset-bottom); }
.pt-safe { padding-top: env(safe-area-inset-top); }
.pl-safe { padding-left: env(safe-area-inset-left); }
.pr-safe { padding-right: env(safe-area-inset-right); }

/* Safe area combinada com padding existente */
.pb-safe-4 { padding-bottom: calc(1rem + env(safe-area-inset-bottom)); }
.pb-safe-3 { padding-bottom: calc(0.75rem + env(safe-area-inset-bottom)); }
```

---

## Keyboard Avoidance (crítico no iOS)

### Problema

No iOS, o teclado virtual não dispara `resize` no `window` — usa `visualViewport`.
O compositor some sob o teclado e o usuário não consegue ver o que está digitando.

### Solução: `useVisualViewport` hook

```ts
// src/hooks/use-visual-viewport.ts — NEW

export function useVisualViewport() {
  const [keyboardHeight, setKeyboardHeight] = React.useState(0)

  React.useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function update() {
      // Diferença entre altura da janela e viewport visual = altura do teclado
      const kbHeight = window.innerHeight - (vv?.height ?? window.innerHeight)
      setKeyboardHeight(Math.max(0, kbHeight))
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return { keyboardHeight }
}
```

### Aplicação no layout do chat

```tsx
// src/components/chat/chat-area.tsx — EDIT

const { keyboardHeight } = useVisualViewport()

// Container do chat area com padding-bottom dinâmico:
<div
  className="flex flex-col h-full"
  style={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight : undefined }}
>
  <MessageList ... />
  <MessageComposer ... />
</div>
```

### Scroll automático ao focar o composer

```ts
// src/components/chat/chat-area/message-composer.tsx — EDIT

const textareaRef = useRef<HTMLTextAreaElement>(null)

// Quando teclado abre, scroll para o final da lista
useEffect(() => {
  if (keyboardHeight > 0) {
    // Aguardar o browser terminar a animação do teclado (~300ms)
    setTimeout(() => {
      scrollToBottom('smooth')
    }, 300)
  }
}, [keyboardHeight])

// No textarea: prevent zoom no iOS (font-size ≥ 16px)
<textarea
  ref={textareaRef}
  style={{ fontSize: '16px' }}   // iOS não faz zoom se >= 16px
  ...
/>
```

---

## Chat Header — Mobile

### Layout atual vs novo

```
ATUAL:
[←] [Avatar] Nome da Conversa    [Bot●] [···]

NOVO (mobile):
[←] [Avatar] Nome                [🤖] [📋] [···]
              Canal • Status       toggle  painel contato
```

**Controles expostos no header mobile:**
- `[←]` — back para lista (existente)
- Avatar + nome + canal label
- Bot toggle pill — clicável direto, sem abrir menu
- Ícone de painel de contato — abre sheet do contato
- Menu `···` — apenas ações destrutivas (delete, assign)

```tsx
// src/components/chat/chat-area/chat-header.tsx — EDIT

// Mobile header simplificado com ações de 1 toque:
<header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle
                   pt-[calc(0.5rem+env(safe-area-inset-top))]">    // ← safe area top

  {/* Back */}
  <Button variant="ghost" size="icon-sm" onClick={onBack} className="md:hidden shrink-0">
    <ArrowLeft className="h-4 w-4" />
  </Button>

  {/* Contato */}
  <button onClick={onOpenContact} className="flex items-center gap-2 min-w-0 flex-1 text-left">
    <ConversationAvatar conversation={conversation} size="sm" />
    <div className="min-w-0">
      <p className="text-[13px] font-semibold text-text-primary truncate">
        {visitorName}
      </p>
      <p className="text-[11px] text-text-tertiary">
        <ChannelBadge channel={conversation.channel} size="xs" inline />
        {' · '}{STATUS_LABELS[conversation.status]}
      </p>
    </div>
  </button>

  {/* Bot toggle — 1 toque */}
  <BotTogglePill
    botStatus={conversation.bot_status}
    onToggle={handleBotToggle}
    compact
  />

  {/* Menu de ações */}
  <ConversationActionsMenu conversation={conversation} compact />
</header>
```

**Safe area:** `pt-[calc(0.5rem+env(safe-area-inset-top))]` — protege do notch.

---

## Message Composer — Mobile

```tsx
// src/components/chat/chat-area/message-composer.tsx — EDIT

<div className="border-t border-border-subtle bg-bg-primary
                pb-[calc(0.75rem+env(safe-area-inset-bottom))]">   // ← safe area bottom

  {/* Barra de ações acima do input — mobile only */}
  <div className="flex items-center gap-1 px-3 pt-2 md:hidden">
    <QuickActionButton icon={Paperclip} label="Attach" onClick={handleAttach} />
    <QuickActionButton icon={Mic} label="Voice" onClick={handleVoice} />
    <QuickActionButton icon={Smile} label="Emoji" onClick={handleEmoji} />
    {/* Espaço */}
    <div className="flex-1" />
    {/* Canal ativo — pill clicável */}
    <ChannelPill channel={activeChannel} onClick={openChannelSelector} />
  </div>

  {/* Input */}
  <div className="flex items-end gap-2 px-3 py-2">
    {/* Botões de ação — desktop only */}
    <div className="hidden md:flex items-center gap-1">
      <QuickActionButton icon={Paperclip} ... />
      <QuickActionButton icon={Mic} ... />
    </div>

    <textarea
      style={{ fontSize: '16px' }}       // evita zoom iOS
      className="flex-1 resize-none bg-transparent text-[15px] leading-relaxed
                 outline-none placeholder:text-text-tertiary min-h-[40px] max-h-[160px]"
      placeholder="Mensagem..."
      rows={1}
      onInput={autoResize}
    />

    {/* Send */}
    <Button
      size="icon"
      className="h-9 w-9 shrink-0 rounded-full"   // touch-friendly circle
      disabled={!content.trim() || isSending}
      onClick={handleSend}
    >
      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
    </Button>
  </div>
</div>
```

### Touch target mínimo: 44×44px

Todos os botões do composer verificados:
- Send: `h-9 w-9` (36px) → `h-11 w-11` no mobile (44px)
- Attach, Mic, Emoji: `h-8 w-8` (32px) → `h-10 w-10` no mobile (40px+padding)

---

## Conversation List — Mobile

### Ações de card visíveis (sem hover)

```tsx
// src/components/chat/conversation-list.tsx — EDIT

// No card, substituir hover-only por:
<div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">

  {/* Mobile: sempre visível */}
  <button
    className="md:opacity-0 md:group-hover:opacity-100 h-8 w-8 rounded-md
               flex items-center justify-center text-text-tertiary
               hover:text-text-primary hover:bg-bg-tertiary transition-all"
    onClick={(e) => { e.stopPropagation(); handlePin(conv.id) }}
  >
    <Pin className={cn('h-3.5 w-3.5', conv.pinned && 'fill-current text-accent')} />
  </button>

  <ConversationCardMenu conversation={conv} />
</div>
```

### Swipe para revelar ações (iOS pattern)

```tsx
// src/components/chat/swipeable-conversation-card.tsx — NEW

// Usando @use-gesture/react (ou React nativo touch events)
// Swipe-left → revela botões: [📌 Pin] [✓ Resolved] [🗑️ Archive]
// Swipe-right → marca como lido

function SwipeableConversationCard({ conversation, children }) {
  const [swipeX, setSwipeX] = useState(0)
  const REVEAL_THRESHOLD = 80   // px necessários para revelar os botões

  const ACTIONS_WIDTH = 180      // largura dos botões revelados

  const bind = useDrag(({ offset: [ox], last }) => {
    if (ox > 0) {
      // swipe-right: marcar como lido (snap back após 0.5s)
      if (last && ox > 60) markAsRead(conversation.id)
    } else {
      // swipe-left: revelar ações
      setSwipeX(Math.max(ox, -ACTIONS_WIDTH))
      if (last) {
        if (Math.abs(ox) > REVEAL_THRESHOLD) setSwipeX(-ACTIONS_WIDTH)
        else setSwipeX(0)   // snap back
      }
    }
  }, { axis: 'x', filterTaps: true })

  return (
    <div className="relative overflow-hidden">
      {/* Ações reveladas atrás */}
      <div className="absolute right-0 top-0 h-full flex items-center gap-1 pr-2"
           style={{ width: ACTIONS_WIDTH }}>
        <SwipeAction icon={Pin} label="Pin" color="blue" onClick={() => togglePin(conversation.id)} />
        <SwipeAction icon={CheckCheck} label="Resolve" color="green" onClick={() => resolve(conversation.id)} />
        <SwipeAction icon={Archive} label="Archive" color="orange" onClick={() => archive(conversation.id)} />
      </div>

      {/* Card que desliza */}
      <div {...bind()} style={{ transform: `translateX(${swipeX}px)`, transition: swipeX === 0 ? 'transform 0.3s ease' : 'none' }}>
        {children}
      </div>
    </div>
  )
}
```

### Pull to refresh

```tsx
// src/components/chat/conversation-list.tsx — EDIT

// Usando React nativo touch events:
const PULL_THRESHOLD = 70

function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullY, setPullY] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startY = useRef(0)

  function onTouchStart(e: TouchEvent) {
    startY.current = e.touches[0].clientY
  }
  function onTouchMove(e: TouchEvent) {
    if (scrollRef.current?.scrollTop !== 0) return   // só no topo
    const dy = e.touches[0].clientY - startY.current
    if (dy > 0) setPullY(Math.min(dy, PULL_THRESHOLD * 1.5))
  }
  async function onTouchEnd() {
    if (pullY >= PULL_THRESHOLD) {
      setIsRefreshing(true)
      hapticFeedback('medium')
      await onRefresh()
      setIsRefreshing(false)
    }
    setPullY(0)
  }

  return { pullY, isRefreshing, handlers: { onTouchStart, onTouchMove, onTouchEnd } }
}

// No topo da lista, quando pullY > 0:
{pullY > 0 && (
  <div className="flex items-center justify-center py-2 text-text-tertiary">
    <Loader2 className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
  </div>
)}
```

### Filtros avançados — Bottom Sheet no mobile

```tsx
// Em vez de um painel lateral flutuante, no mobile abrir como bottom sheet:

function FilterButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)} className="relative">
        <Filter className="h-4 w-4" />
        {activeFilterCount > 0 && <FilterBadge count={activeFilterCount} />}
      </button>

      {/* Mobile: bottom sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="h-[80vh] pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <FilterPanel onApply={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}
```

### Search — Input mobile otimizado

```tsx
// Remover o hint ⌘K no mobile:
<kbd className="hidden md:inline-flex ...">⌘K</kbd>

// Ao focar o search no mobile: expandir para tela cheia
// Ao perder foco com query vazia: colapsar de volta
```

---

## Contact Info Panel — Mobile (complementar ao SEED-039)

### Bottom Sheet com drag handle

```tsx
// src/components/chat/contact-info-panel.tsx — EDIT
// No mobile, transformar o panel em bottom sheet deslizável

// Desktop (≥1024px): painel lateral fixo (existente)
// Mobile (<1024px): bottom sheet com:
//   - Drag handle no topo
//   - Snap: 40% (preview) | 80% (completo) | fechado
//   - Swipe down fecha

// Implementação com framer-motion:
<motion.div
  drag="y"
  dragConstraints={{ top: 0, bottom: sheetMaxHeight }}
  dragElastic={0.1}
  onDragEnd={(_, { offset, velocity }) => {
    if (offset.y > 150 || velocity.y > 500) closePanel()
    else snapToPosition()
  }}
  animate={{ y: isOpen ? 0 : '100%' }}
  transition={{ type: 'spring', damping: 30, stiffness: 300 }}
  className="fixed inset-x-0 bottom-0 z-50 bg-bg-primary rounded-t-[20px]
             shadow-[0_-4px_24px_rgba(0,0,0,0.15)]
             pb-[env(safe-area-inset-bottom)]"
>
  {/* Drag handle */}
  <div className="flex justify-center pt-3 pb-1">
    <div className="h-1 w-10 rounded-full bg-border-strong" />
  </div>

  {/* Conteúdo scrollável */}
  <ScrollArea className="h-[calc(80vh-2rem)]">
    <ContactPanelContent contact={contact} ... />
  </ScrollArea>
</motion.div>
```

---

## Navegação mobile — Fluxo completo

```
LISTA DE CONVERSAS (tela cheia)
│
│  Tap em conversa → slide horizontal para →
│
CHAT AREA (tela cheia)
│
│  ← botão back → volta para lista
│  tap no avatar/nome → slide vertical para cima →
│  swipe-down → fecha painel de contato
│
PAINEL DE CONTATO (bottom sheet, 80vh)
│
│  drag-down → fecha
│  voltar ao chat → apenas fechar sheet (chat ainda ativo)
```

### Transições entre views

```tsx
// Trocar de `mobileView` com animação de slide:

// lista → chat: slide da direita para esquerda
// chat → lista: slide da esquerda para direita
// chat → contato: slide de baixo para cima
// contato → chat: slide de cima para baixo

// Usar CSS transitions com transform, não framer-motion (performance mobile):
<div
  className="absolute inset-0 transition-transform duration-300 ease-in-out"
  style={{ transform: mobileView === 'list' ? 'translateX(0)' : 'translateX(-100%)' }}
>
  <ConversationList ... />
</div>
<div
  className="absolute inset-0 transition-transform duration-300 ease-in-out"
  style={{ transform: mobileView === 'chat' ? 'translateX(0)' : 'translateX(100%)' }}
>
  <ChatArea ... />
</div>
```

---

## Feedback háptico

```ts
// src/lib/haptics.ts — NEW

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

export function hapticFeedback(style: HapticStyle = 'light') {
  // iOS PWA: navigator.vibrate (suporte limitado)
  // Android Chrome: navigator.vibrate
  if (!('vibrate' in navigator)) return

  const patterns: Record<HapticStyle, number | number[]> = {
    light: 10,
    medium: 20,
    heavy: 40,
    success: [10, 50, 10],
    warning: [20, 100, 20],
    error: [50, 100, 50],
  }

  navigator.vibrate(patterns[style])
}
```

**Onde usar:**
- Swipe-reveal de ações no card → `hapticFeedback('light')` ao revelar
- Enviar mensagem → `hapticFeedback('light')`
- Marcar como resolvido → `hapticFeedback('success')`
- Erro ao enviar → `hapticFeedback('error')`
- Pull to refresh → `hapticFeedback('medium')` ao atingir threshold

---

## Toast — Reposicionamento

```tsx
// src/app/layout.tsx — EDIT
// Mover toasts para bottom-center no mobile, longe do composer

// Solução: usar CSS para sobrescrever a posição no mobile
// Sonner suporta `style` prop para customização
<Toaster
  position="bottom-right"    // desktop
  toastOptions={{
    style: {
      // No mobile, mover para cima do safe area + uma margem
      '--offset': 'calc(env(safe-area-inset-bottom) + 80px)',
    },
  }}
/>
```

Ou: criar hook que detecta se o composer está focado e move os toasts para o topo:
```ts
// Se teclado aberto → toasts no topo
// Se teclado fechado → toasts no bottom (padrão)
```

---

## Dependências novas

```json
// package.json — adicionar se não existir:
"@use-gesture/react": "^10.x"   // para swipe gestures
// framer-motion já instalado (usado em outros lugares)
```

---

## Arquivos

```
src/app/layout.tsx                              EDIT: viewport config + safe areas
src/app/globals.css                             EDIT: utilitários .pb-safe, .pt-safe

src/hooks/use-visual-viewport.ts                NEW: detecção de teclado virtual
src/lib/haptics.ts                              NEW: feedback háptico

src/components/chat/
├── chat-layout.tsx                             EDIT: transições CSS entre views
├── conversation-list.tsx                       EDIT: swipe card, pull-to-refresh,
│                                                     filtros como bottom sheet,
│                                                     ações visíveis sem hover,
│                                                     search sem ⌘K hint
├── swipeable-conversation-card.tsx             NEW: swipe-to-reveal actions
├── contact-info-panel.tsx                      EDIT: bottom sheet + drag handle mobile

src/components/chat/chat-area/
├── chat-header.tsx                             EDIT: safe area top, bot toggle exposto,
│                                                     tap no nome abre contato
├── message-list.tsx                            EDIT: scroll behavior com visualViewport
├── message-composer.tsx                        EDIT: safe area bottom, fontSize 16px,
│                                                     quick actions barra mobile,
│                                                     keyboard avoidance, touch targets
└── channel-selector.tsx                        EDIT: bottom sheet no mobile (SEED-039)
```

---

## Checklist de touch targets (WCAG 2.5.5 — 44×44px mínimo)

| Elemento | Atual | Mobile |
|---------|-------|--------|
| Send button | 36×36px | 44×44px |
| Back button | 32×32px | 44×44px |
| Bot toggle | 28px height | 44px height |
| Quick actions (attach, mic) | 32×32px | 40×40px + padding |
| Swipe action buttons | — | 64×100% |
| Card pin button | 28×28px | 44×44px (tap area) |

---

## Critérios de sucesso

1. ✅ iPhone com notch/Dynamic Island: nenhum botão ou conteúdo oculto
2. ✅ Composer permanece visível e acessível quando teclado virtual abre
3. ✅ Textarea não dispara zoom do iOS (font-size 16px)
4. ✅ Swipe-left em card revela ações: Pin, Resolve, Archive
5. ✅ Swipe-right marca conversa como lida
6. ✅ Pull down na lista de conversas faz refresh
7. ✅ Painel de contato abre como bottom sheet deslizável (80vh)
8. ✅ Drag down no painel de contato fecha o sheet
9. ✅ Transição list→chat é horizontal slide, chat→contato é vertical slide
10. ✅ Filtros avançados abrem como bottom sheet no mobile
11. ✅ Hint ⌘K não aparece em touch devices
12. ✅ Toasts não sobrepõem o composer quando teclado está aberto
13. ✅ Feedback háptico em ações principais (send, swipe, resolve)
14. ✅ Todos os botões têm área de toque ≥ 44×44px
15. ✅ `npm run build` passa sem erros de tipo
