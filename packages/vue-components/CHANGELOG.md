# @openape/vue-components

## 0.2.5

### Patch Changes

- Updated dependencies [[`38c5c3c`](https://github.com/openape-ai/openape/commit/38c5c3cf1c2a4b11c4942e4e9eee6ddcec2deff9)]:
  - @openape/core@0.15.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`146a5a3`](https://github.com/openape-ai/openape/commit/146a5a3dd3960b42c7f40a0ece0f7c361934c323)]:
  - @openape/core@0.14.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2

## 0.2.2

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1

## 0.2.1

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0

## 0.2.0

### Minor Changes

- [#48](https://github.com/openape-ai/openape/pull/48) [`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add proactive widening suggestions to grant approval.

  When a user approves a pending structured CLI grant for the first time, the IdP now
  pre-computes a list of scope options derived from the request (exact, sibling-type,
  directory, subtree, wildcard) and presents them as radio buttons in the approval UI.
  The approver can choose how broad the grant should be in a single click instead of
  needing a second request to trigger the widen flow.

  - `@openape/grants` adds `suggestWideningsForDetail`, `buildWideningSuggestionsForGrant`,
    and `approveGrantWithWidening` with server-side validation (structural match +
    coverage) that rejects any client-forged "widening" that would be a different grant.
  - `@openape/nuxt-auth-idp` attaches `widening_suggestions` to pending CLI grants in
    `GET /api/grants/[id]` and accepts an optional `widened_details` body parameter in
    `POST /api/grants/[id]/approve` (mutually exclusive with `extend_mode`).
  - `@openape/vue-components` and the nuxt-auth-idp `grant-approval.vue` page render
    the scope radio group when no similar grants exist. Conservative default: exact.
