# Phase 113: Workflow Event and Documentation - Context

## Goal

Turn accepted lead receipts into tenant-configurable workflow triggers without coupling ingestion success to workflow success.

## Decisions

- `lead.captured` fires once per unique receipt.
- `contact.created` fires only when ingestion inserts a new contact.
- Workflow executions remain fire-and-forget after the durable audit row is written.
- The public documentation requires one scoped key per Websites tenant connection.
