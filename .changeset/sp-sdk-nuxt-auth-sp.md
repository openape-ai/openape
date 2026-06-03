---
"@openape/nuxt-auth-sp": minor
---

Provide shared CLI token-exchange server utilities so SPs no longer copy `cli-token.ts`/`ddisa-issuer.ts`/the `/api/cli/exchange` handler: `signCliToken`/`verifyCliToken`, `resolveIssuerForToken`/`unsafeDecodeSub`, and `createCliExchangeHandler()` (issuer/audience taken from `openapeSp.clientId`). Hardened with an SSRF guard on the DDISA-resolved IdP issuer (`assertSafeIdpUrl`: https-only, blocks loopback/RFC1918/link-local/CGNAT/IPv6-ULA, 5s JWKS-fetch timeout). Dev hatch: `OPENAPE_SP_ALLOW_INSECURE_IDP=1`.
