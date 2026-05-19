# Requirements: v2.8 Scheduling Hardening

**Milestone:** v2.8
**Status:** In Progress

---

## Scheduling Hardening (SCHED)

- **SCHED-01:** Partial unique index `(event_type_id, start_at) WHERE status='confirmed'` previne double-booking via DB constraint
- **SCHED-02:** `createBooking` retorna `slot_taken` quando unique constraint dispara (não erro 500)
- **SCHED-03:** Rate limiter na rota `/book/[slug]/[eventType]` — máx 5 bookings por IP / hora
- **SCHED-04:** Email de confirmação enviado ao booker após booking criado — host, evento, data/hora, link de cancelamento
- **SCHED-05:** Email de cancelamento enviado quando booking é cancelado
- **SCHED-06:** Email failures são fire-and-forget (não bloqueiam booking)
- **SCHED-07:** Auto-criação de contato no booking respeita custom_field_definitions required da org (defaults sensatos)
- **SCHED-08:** Fallback graceful: contato é criado sem custom_fields se validation falhar (warning log)
- **SCHED-09:** Testes unitários para `generateSlots` cobrindo availability, busy times, timezone DST, advance notice
- **SCHED-10:** Testes para `createBooking` cobrindo race condition + contact link
- **SCHED-11:** Testes para `cancelBookingByToken` validando token correto + status check
- **SCHED-12:** Testes para `getAvailableSlots` integrando availability + bookings + GCal busy
