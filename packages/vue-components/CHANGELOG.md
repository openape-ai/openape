# @openape/vue-components

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
