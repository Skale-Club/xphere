# Roadmap: v2.9 UX Polish & Feature Completeness

**Milestone:** v2.9
**Theme:** UX Polish, Notifications, Light Theme, Workflows Unification

## Active Phases

### Phase 103 — In-App Notification System
**Goal:** Real-time in-app notifications delivered via Supabase Realtime, persisted in DB, with bell icon in header.
- Notification bell in header with unread count badge
- Notification panel/dropdown with list of events
- Types: new conversation, missed call, new contact, campaign finished, flow run failed
- Mark as read (individual + mark all read)
- Supabase Realtime for live delivery
- Persistence in DB (notifications table, per-org, per-user)

### Phase 104 — Light Theme
**Goal:** Full light mode with theme toggle persisted per user and system preference detection.
- Full light mode via CSS variables / Tailwind dark: prefix
- Theme toggle (dark/light) in header or settings
- Persisted per user (DB or localStorage)
- All dashboard pages, sidebar, components adapted
- System preference detection on first visit

## Upcoming Phases (v2.9)
- Phase 97–102: UX Polish, Header Reorg, Flow Canvas, Workflows Unification (see milestones/v2.9-ROADMAP.md)
