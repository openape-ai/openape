---
'@openape/auth': minor
'@openape/nuxt-auth-idp': minor
---

DDISA `mode=allowlist-admin` is now a real, plug-in-able feature. Closes #307.

**`@openape/auth`** gains `AdminAllowlistStore` + `InMemoryAdminAllowlistStore`. `evaluatePolicy` accepts an optional 5th `options` arg with `adminAllowlistStore`; with no store wired up the mode keeps its previous safe-deny behaviour.

**`@openape/nuxt-auth-idp`** wires the new store into `useIdpStores`, exposes a `defineAdminAllowlistStore(...)` registration helper, and adds two pluggable admin resolvers on `event.context`:

- `openapeAdminResolver(event, email): boolean` — overrides the env-config email allowlist for `requireAdmin`.
- `openapeRootAdminResolver(event, email): boolean` — strict tier for actions that must NOT be gateable by env config (e.g. operator promotion). New `requireRootAdmin` consults it; without one registered, fails closed.

Existing apps without these hooks set keep working — `requireAdmin` falls back to the legacy `OPENAPE_ADMIN_EMAILS` env list.
