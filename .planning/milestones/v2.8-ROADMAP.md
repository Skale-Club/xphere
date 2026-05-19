# Roadmap: v2.8 Scheduling Hardening

**Workstream:** v28-scheduling-hardening
**Phases:** 4 (93–96) | **Requirements:** 12 (SCHED-01..12)

---

## Phase 93: SCHED-HARDENING

**Goal:** Eliminar race condition no booking via partial unique index + rate limiting na rota pública `/book/*` para prevenir spam.
**Depends on:** Nothing (first phase of v2.8)
**Requirements:** SCHED-01, SCHED-02, SCHED-03
**UI hint:** no
**Success Criteria:**
1. Migration `072_scheduling_hardening.sql` cria partial unique index `(event_type_id, start_at) WHERE status='confirmed'` na tabela bookings
2. Race condition fix: insert duplicado retorna `slot_taken` (não erro 500)
3. Rate limiting na rota `/book/[slug]/[eventType]` — máx 5 bookings por IP / 1h via Upstash Redis (já configurado no projeto)
4. `npm run build` exits 0

**Plans:** 2
- [ ] 93-01-PLAN.md — Migration 072 partial unique index + atualizar createBooking error handling
- [ ] 93-02-PLAN.md — Rate limiter para /book/* via lib/rate-limit (criar se não existir)

---

## Phase 94: SCHED-EMAILS

**Goal:** Enviar email de confirmação ao booker quando booking é criado e email de cancelamento quando cancelado. Usar Resend (já no projeto se disponível, senão SMTP via Supabase).
**Depends on:** Phase 93
**Requirements:** SCHED-04, SCHED-05, SCHED-06
**UI hint:** no
**Success Criteria:**
1. `src/lib/scheduling/emails.ts` com `sendBookingConfirmation(booking)` e `sendBookingCancellation(booking)`
2. Email de confirmação contém: host name, event type, data/hora no timezone do booker, link de cancelamento com cancel_token
3. Email de cancelamento contém: confirmação do cancelamento + link para rebookar
4. Fire-and-forget (não bloqueia booking se email falhar)
5. Templates HTML básicos com brand do Xphere
6. `npm run build` exits 0

**Plans:** 2
- [ ] 94-01-PLAN.md — Resend client + template helper + sendBookingConfirmation
- [ ] 94-02-PLAN.md — sendBookingCancellation + integração nos action handlers

---

## Phase 95: SCHED-CUSTOM-FIELDS

**Goal:** Quando booking auto-cria contato no CRM, respeitar as `custom_field_definitions` `required` da org (se existirem) com defaults sensatos, ou pelo menos não quebrar.
**Depends on:** Phase 93
**Requirements:** SCHED-07, SCHED-08
**UI hint:** no
**Success Criteria:**
1. `createBooking` ao criar contato preenche custom_fields_data com defaults para required fields (string vazia, false, null conforme tipo)
2. Se schema de custom_fields_data validation rejeitar, fallback: cria contato sem custom fields (não bloqueia booking)
3. Logged warning quando fallback é acionado
4. `npm run build` exits 0

**Plans:** 1
- [ ] 95-01-PLAN.md — Wrapping de createContact em scheduling com custom fields defaults

---

## Phase 96: SCHED-TESTS

**Goal:** Cobertura de testes unitários para o lib/scheduling — slot generation, race conditions, timezone math.
**Depends on:** Phase 93
**Requirements:** SCHED-09, SCHED-10, SCHED-11, SCHED-12
**UI hint:** no
**Success Criteria:**
1. `tests/scheduling-slots.test.ts` — 8+ casos: availability vazia, slot disponível, slot ocupado por booking, slot ocupado por busy time GCal, minAdvanceMinutes filter, timezone DST edge cases, duração mínima/máxima
2. `tests/scheduling-bookings.test.ts` — 6+ casos: createBooking sucesso, race condition (conflict), cancelByToken, getAvailableSlots integração, contact link existente, contact link novo
3. Mock do Supabase via padrão `accounts-actions.test.ts`
4. `npx vitest run tests/scheduling-*.test.ts` exits 0
5. `npm run build` exits 0

**Plans:** 2
- [ ] 96-01-PLAN.md — scheduling-slots.test.ts (slot generation unit tests)
- [ ] 96-02-PLAN.md — scheduling-bookings.test.ts (server action integration tests)
