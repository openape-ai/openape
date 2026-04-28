---
"openape-free-idp": minor
---

idp: per-audience YOLO policies + audience-bucket registry (M3 foundation)

Splits the per-agent YOLO policy table so an operator can YOLO `ape-proxy`
without YOLOing `ape-shell` (or vice versa). The data layer was previously
flat (one policy per agent, applied to every audience); after M2 added
`ape-proxy` as a first-class audience alongside the pre-existing `ape-shell`,
`claude-code`, `escapes`, and `shapes`, that flatness conflated trust
domains that should be independent.

### Schema migration

`yolo_policies` PK changes from `agent_email` to `(agent_email, audience)`.
Existing rows are preserved as `audience='*'` (= per-agent fallback).
Migration runs once in `06.yolo-hook.ts` and is gated on the absence of the
`audience` column so it's idempotent across reboots. Recreate-pattern
because SQLite can't change a PK in place.

### Lookup semantic

`store.get(agentEmail, audience)` does most-specific-wins:

1. Try `(agentEmail, audience)` exact row.
2. Fall through to `(agentEmail, '*')` wildcard row.
3. Return null if neither exists.

The IdP pre-approval hook now passes `request.audience` so an `ape-proxy`
grant looks up the proxy-scoped policy first, then the agent's wildcard,
and only YOLO-approves if either matches.

### API back-compat

Existing `/api/users/:email/yolo-policy.{get,put,delete}` endpoints keep
working unchanged. The new optional `?audience=` query parameter targets
a specific audience; without it, the endpoint operates on the wildcard
row (= the previous behavior). `?audience=__all__` on GET returns every
per-agent row across all audiences for the upcoming UI.

### Audience-bucket registry

New module `apps/openape-free-idp/server/utils/audience-buckets.ts` groups
audiences into the three policy-enforcement layers:

- **commands** — `ape-shell`, `claude-code`, `shapes` (per-line / per-tool gates)
- **web** — `ape-proxy` (per-host network egress)
- **root** — `escapes` (privilege elevation)
- **other** — fallback for unknown audiences

Bucket is purely UI/UX grouping; never affects grant evaluation. The UI
redesign on `/agents/:email` (separate PR) will use this to render
per-bucket sections for YOLO + deny rules + standing grants.

No UI changes in this PR — that's the explicit follow-up.
