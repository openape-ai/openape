---
"@openape/auth": patch
---

Declare the `ofetch` runtime dependency. `idp/client-metadata.ts` imports it, but
it was previously resolved only via workspace hoisting — which broke isolated
installs and Docker builds (esbuild "Could not resolve ofetch" / TS2307) the
moment the package was built outside the hoisted monorepo `node_modules`.
