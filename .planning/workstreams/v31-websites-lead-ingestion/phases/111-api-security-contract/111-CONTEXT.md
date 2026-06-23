# Phase 111: API Security and Contract - Context

## Goal

Establish the least-privilege public API boundary used by Skale Club Websites.

## Decisions

- Xphere derives organization identity exclusively from the bearer key.
- Websites receives a dedicated `leads:write` scope.
- Public API verification is centralized and returns stable 401/403 outcomes.
- The lead envelope is strict, versioned, size-bounded, and excludes `org_id`.

## Scope

API-key verification, contacts scope enforcement, integration-info, lead schema, and contract tests.
