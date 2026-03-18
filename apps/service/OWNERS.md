# OWNERS: service (`@openape/cloud`)

## Ownership Boundary

- Product scope: Multi-tenant cloud dashboard, org/domain lifecycle, billing flows.
- Security scope: Tenant resolution/context middleware, IdP runtime config, platform admin paths.
- Operational scope: Storage drivers, Stripe integration, usage reporting cron/webhooks.

## Maintainers

- Primary owner: `TBD (assign GitHub user/team)`
- Backup owner: `TBD (assign GitHub user/team)`

## Review Rules

- Require owner review for changes to:
  - `server/api/platform/**`
  - `server/middleware/**`
  - `server/utils/**`
  - `nuxt.config.ts`, `vercel.json`, and billing/storage/runtime config handling
