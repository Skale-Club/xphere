# Deferred items — Phase 110-app-wiring

Pre-existing issues encountered during plan execution that are out of scope for Phase 110.

## CSV mapping: Portuguese 'nome' resolves to first_name (not name)

- **Discovered in:** Plan 110-06 while running `tests/contacts-csv-import.test.ts`
- **File:** `src/lib/contacts/csv.ts` (suggestColumnMapping)
- **Failing test:** `suggestColumnMapping > maps Portuguese variants` (`expect(m['nome']).toBe('name')` — actual `'first_name'`)
- **Root cause:** introduced by commit `361b650` ("contact info template and names utility") which added first/last name parsing to mapping suggestions. The Portuguese alias `nome` now maps to `first_name` instead of the full-name field.
- **Scope:** pre-existing failure, NOT caused by Plan 110-06. Pre-flight refactor changes do not touch `suggestColumnMapping`.
- **Recommendation:** decide whether the new behavior (split-name preference) is intended; if so, update the test expectation. Track in a future plan.
