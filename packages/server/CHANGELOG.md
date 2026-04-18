# @openape/server

## 0.2.2

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0
  - @openape/grants@0.9.0
  - @openape/auth@0.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [[`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02)]:
  - @openape/grants@0.8.0

## 0.2.0

### Minor Changes

- Initial release. Programmatic DDISA IdP and SP server built on h3. `createIdPApp(config)` starts a full IdP with ed25519 challenge-response auth, OIDC authorize/token flow, grant lifecycle, admin SSH key management. `createSPApp(config)` starts a Service Provider with login, callback, and session management. All endpoints work with in-memory stores — ideal for testing and lightweight deployments.

### Patch Changes

- Updated dependencies []:
  - @openape/auth@0.6.0
  - @openape/core@0.12.0
  - @openape/grants@0.7.0
