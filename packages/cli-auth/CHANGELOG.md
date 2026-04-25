# @openape/cli-auth

## 0.2.0

### Minor Changes

- [#161](https://github.com/openape-ai/openape/pull/161) [`5b31d7e`](https://github.com/openape-ai/openape/commit/5b31d7ef1ee1b1c9f9b043253f1e3f32383937fa) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Initial release of `@openape/cli-auth` — shared client-side auth library for OpenApe CLIs.

  Provides:

  - `getAuthorizedBearer({ endpoint, aud, scopes? })` — one-shot helper that returns a valid `Bearer …` header for any OpenApe SP, handling IdP-token refresh + SP-token exchange + caching transparently.
  - `ensureFreshIdpAuth()` — refresh the IdP-issued OAuth access token if needed (using the stored refresh_token).
  - `exchangeForSpToken(idpAuth, request)` — RFC 8693-style token exchange against an SP's `/api/cli/exchange` endpoint.
  - Storage primitives for the IdP-token (shared with `@openape/apes` at `~/.config/apes/auth.json`) and SP-tokens (per-audience under `~/.config/apes/sp-tokens/`).
  - Error types `AuthError`, `NotLoggedInError`.

  Designed to be the auth dependency for `@openape/apes`, `@openape/ape-plans`, `@openape/ape-tasks`, `@openape/ape-secrets`, and `@openape/ape-seeds`. After `apes login` once, every other CLI works without re-authenticating per service.

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2
