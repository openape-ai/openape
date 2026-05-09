# @openape/cli-auth

## 0.4.0

### Minor Changes

- [#370](https://github.com/openape-ai/openape/pull/370) [`8ca96f1`](https://github.com/openape-ai/openape/commit/8ca96f10f7a0a9c8adc5afa5c8fd863f62342f6c) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Wire up delegation token-exchange end-to-end:

  - **`@openape/cli-auth`** exports `exchangeWithDelegation()` — posts an actor token + (optional) delegation grant id to the IdP's `/api/oauth/token-exchange` and returns a delegated access token whose `sub` is the delegator.
  - **`@openape/apes`** `registerAgentAtIdp()` now checks if the local caller is itself an agent. If yes, it lists the owner's approved grants, finds the first delegation grant for the `enroll-agent` audience, exchanges tokens, and presents the delegated access token as `Authorization: Bearer …` to `/api/enroll`. Falls back to the direct call (caller-as-requester) when no delegation is configured — the IdP's transitive-ownership lookup still covers that path until M3.
  - **IdP token-exchange** (`@openape/nuxt-auth-idp`) accepts a `delegation_grant_id` without requiring a `subject_token`: when the grant id is provided, the delegator identity is derived from `grant.delegator` and `subject_token` becomes optional (it can still be supplied for belt-and-suspenders verification, in which case its sub must match the grant's delegator).

  The `subject_token`-only path (RFC 8693 strict mode) and the new `delegation_grant_id`-only path coexist on the same endpoint.

## 0.3.0

### Minor Changes

- [#260](https://github.com/openape-ai/openape/pull/260) [`6539c9b`](https://github.com/openape-ai/openape/commit/6539c9b290b9d9f062f54dfdf5378957ee668018) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - In-process Ed25519 challenge-response refresh for agent IdP tokens (closes #259).

  Agent tokens have no `refresh_token` — the IdP's `/agent/authenticate` endpoint deliberately doesn't issue one. Before this change, `ensureFreshIdpAuth` threw `NotLoggedInError` when an agent token expired, which left the chat-bridge daemon in a 1-hour crash-restart loop: launchd's KeepAlive bounced the process every time the cached token aged out, the start.sh shell-out re-ran `apes login` to mint a fresh one, and the cycle repeated.

  - **`@openape/cli-auth`** now refreshes agent tokens in-process. When `auth.json.refresh_token` is missing but `key_path` (or `~/.ssh/id_ed25519`) is present, `ensureFreshIdpAuth` signs a new challenge against the IdP's `/agent/challenge` + `/agent/authenticate` endpoints — same flow `apes login --key` uses — and persists the rotated token. The chat-bridge daemon now stays connected across the 1h expiry boundary.
  - **`@openape/apes`**: `apes login` and `apes agents spawn` write `key_path` into auth.json so any cli-auth consumer (chat-bridge, ape-tasks, ape-plans, …) inherits the in-process refresh capability for free. `saveAuth` merges with existing fields so older spawns retain `owner_email` across logins (mirrors PR #257's cli-auth fix). `start.sh` no longer shells out to `apes login` at boot — the install is now ~3-5s instead of doing the legacy refresh dance.
  - **`@openape/cli-auth`** new public types: `IdpAuth.key_path` (optional, absolute path to the Ed25519 signing key).

## 0.2.4

### Patch Changes

- [`b519e3f`](https://github.com/openape-ai/openape/commit/b519e3f858011358056daaec8f54a2694c59f191) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix bridge crash-loop "auth.json missing 'owner_email'" after `apes login`.

  - `@openape/cli-auth`: `saveIdpAuth` now merges with existing fields instead of overwriting wholesale. `apes login` (called from the bridge's `start.sh` on every daemon boot) used to silently drop `owner_email` written by `apes agents spawn`, leaving the bridge in a fatal restart loop until the auth.json was manually re-stamped. The merge preserves any unknown keys in the file across logins.
  - `@openape/chat-bridge`: `readAgentIdentity` falls back to `OPENAPE_OWNER_EMAIL` env var when `owner_email` is missing from auth.json, so an old agent (spawned before the Phase A migration) can be unblocked by adding one line to its launchd plist.

## 0.2.3

### Patch Changes

- [#165](https://github.com/openape-ai/openape/pull/165) [`27e13fd`](https://github.com/openape-ai/openape/commit/27e13fdc9d3c1f399326eba4d05d74c479ecf53e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Bump to trigger publish via the now-fixed publish-chain.mjs script (cli-auth was missing from the explicit PACKAGES list, so previous version bumps built but never published).

## 0.2.2

### Patch Changes

- [#162](https://github.com/openape-ai/openape/pull/162) [`29bd8f2`](https://github.com/openape-ai/openape/commit/29bd8f20a439a4c75f0b570b1a77eaacac875af5) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Drop unused `@openape/core` dependency. The lib only uses `ofetch` and Node built-ins; `@openape/core` was inherited from the apes scaffold but never imported. Removing it unblocks downstream installs that previously failed because the package was published with `"@openape/core": "workspace:*"` literally (npm publish doesn't substitute the workspace protocol — only `pnpm publish` does, and the bootstrap publish accidentally went through plain `npm`).

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
