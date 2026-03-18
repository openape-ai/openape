# OWNERS: openape-agent-mail

## Ownership Boundary

- Product scope: Agent mailboxes, domains, inbound/outbound message APIs.
- Security scope: API key/auth middleware, admin mailbox/domain management, webhook validation.
- Operational scope: Mail transport providers, DB schema/migrations, quota enforcement.

## Maintainers

- Primary owner: `TBD (assign GitHub user/team)`
- Backup owner: `TBD (assign GitHub user/team)`

## Review Rules

- Require owner review for changes to:
  - `server/api/**`
  - `server/middleware/**`
  - `server/utils/**`
  - `server/database/**`
  - `nuxt.config.ts` and environment/runtime config handling
