---
'@openape/nuxt-auth-idp': minor
---

Phase 2 of the policy shift: Web UI for agent management and
pre-authorization.

## What's new

Two new pages on `id.openape.at`:

- **`/agents`** — list of all agents owned by the logged-in user, with
  grant-activity counters and standing-grant count.
- **`/agents/:email`** — per-agent detail page with:
  - Existing approved standing grants (scope description + revoke action)
  - Inline form to create a new standing grant: CLI picker (populated
    from the server-side shape registry), wildcard resource-chain
    textarea (`resource:key=value` format), max-risk selector, grant
    type (always/timed), optional duration + reason.
  - Recent activity table (last 20 grants from this agent), with
    ⚡ marker on rows that were auto-approved by a standing grant.

## Helper utilities (new)

- `modules/nuxt-auth-idp/src/runtime/utils/standing-grants.ts`
  - `formatStandingGrantScope(sg)` — render scope as a human string
  - `formatResourceChainTemplate(chain)` — summarise wildcards/selectors
  - `parseResourceChainInput(text)` — parse the textarea input into
    `OpenApeCliResourceRef[]`
  - `formatRelativeTime(seconds)` — "just now" / "Nm ago" / "Nh ago"

Tests cover the parser, formatter, scope rendering, and time helper (+19 tests).

## Backward-compatibility

Fully backward-compatible — pages are additive, no existing API changes.
