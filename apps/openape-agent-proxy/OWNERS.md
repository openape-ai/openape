# OWNERS: openape-agent-proxy

## Ownership Boundary

- Product scope: Agent-facing proxy dashboard and SP integration UX.
- Security scope: SP session/auth middleware and OpenApe provider configuration.
- Operational scope: Runtime/client configuration, app routing, deployment config.

## Maintainers

- Primary owner: `TBD (assign GitHub user/team)`
- Backup owner: `TBD (assign GitHub user/team)`

## Review Rules

- Require owner review for changes to:
  - `app/middleware/**`
  - `app/pages/**`
  - `nuxt.config.ts` and environment/runtime config handling
