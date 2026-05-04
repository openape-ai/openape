# Changelog

## 0.8.4

### Patch Changes

- Updated dependencies [[`f787da5`](https://github.com/openape-ai/openape/commit/f787da57a04e3f5ea57395c16278f24fd89c5ebc)]:
  - @openape/auth@0.8.0

## 0.8.3

### Patch Changes

- Updated dependencies [[`8271991`](https://github.com/openape-ai/openape/commit/8271991f42d18a32b8dfd4e7306f6dd294d3a286)]:
  - @openape/auth@0.7.2

## 0.8.2

### Patch Changes

- Updated dependencies [[`146a5a3`](https://github.com/openape-ai/openape/commit/146a5a3dd3960b42c7f40a0ece0f7c361934c323)]:
  - @openape/core@0.14.0
  - @openape/auth@0.7.1

## 0.8.1

### Patch Changes

- Updated dependencies [[`cbcffc7`](https://github.com/openape-ai/openape/commit/cbcffc74d7fe08520c1a18f2d546181446c1cfca)]:
  - @openape/auth@0.7.0

## 0.8.0

### Minor Changes

- [#154](https://github.com/openape-ai/openape/pull/154) [`eff0061`](https://github.com/openape-ai/openape/commit/eff0061704cd88a80654b4df49a8bb7afd82016a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Explicit `maxAge` on the logged-in session cookie (`openape-sp`) so iOS Safari keeps the session across tab-close / backgrounding.

  - New `openapeSp.sessionMaxAge` module option (default: 604800 seconds = 7 days). Env: `NUXT_OPENAPE_SP_SESSION_MAX_AGE`.
  - `getSpSession` now sets `cookie.maxAge` + `cookie.httpOnly` + `cookie.secure` + `cookie.sameSite: 'lax'` explicitly. Previous behaviour relied on h3's default (session cookie without explicit expiry), which iOS aggressively evicts.
  - Backwards compatible: existing apps inherit the 7-day default without any config change.

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2
  - @openape/auth@0.6.3

## 0.7.0

### Minor Changes

- [#153](https://github.com/openape-ai/openape/pull/153) [`6636d6a`](https://github.com/openape-ai/openape/commit/6636d6ad7add3818aabe6d0454951a65e81bddc8) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Explicit `maxAge` on the logged-in session cookie (`openape-sp`) so iOS Safari keeps the session across tab-close / backgrounding.

  - New `openapeSp.sessionMaxAge` module option (default: 604800 seconds = 7 days). Env: `NUXT_OPENAPE_SP_SESSION_MAX_AGE`.
  - `getSpSession` now sets `cookie.maxAge` + `cookie.httpOnly` + `cookie.secure` + `cookie.sameSite: 'lax'` explicitly. Previous behaviour relied on h3's default (session cookie without explicit expiry), which iOS aggressively evicts.
  - Backwards compatible: existing apps inherit the 7-day default without any config change.

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1
  - @openape/auth@0.6.2

## 0.6.10

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0
  - @openape/auth@0.6.1

## 0.6.9

### Patch Changes

- Fix ReDoS-vulnerable regex in proxy auth header parsing. Fix lint violations across packages. Update import paths for CLI permissions moved to @openape/grants.

- Updated dependencies []:
  - @openape/auth@0.6.0
  - @openape/core@0.12.0

## 0.6.8

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0
  - @openape/auth@0.5.7

## 0.6.7

### Patch Changes

- Updated dependencies [[`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/core@0.10.0
  - @openape/auth@0.5.6

## 0.6.6

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0
  - @openape/auth@0.5.5

## 0.6.5

### Patch Changes

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

- Updated dependencies []:
  - @openape/core@0.7.1
  - @openape/auth@0.5.4

## 0.6.4

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.7.0
  - @openape/auth@0.5.3

## 0.6.3

### Patch Changes

- Updated dependencies [[`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f)]:
  - @openape/core@0.6.0
  - @openape/auth@0.5.2

## 0.6.2

### Patch Changes

- fix: correct @openape/core dependency (was ^0.4.0 with ES256, needs ^0.5.0 for EdDSA)

- Updated dependencies []:
  - @openape/auth@0.5.1

## 0.6.1

### Patch Changes

- fix: correct @openape/auth dependency range (was ^0.3.0 in published 0.6.0, needs ^0.5.0 for createClientMetadata)
