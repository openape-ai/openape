---
'@openape/grants': minor
'@openape/idp-test-suite': minor
---

Phase 5: glob-pattern support in coverage + mobile-first scoped-command authoring.

- `cliAuthorizationDetailCovers` now treats `*` inside granted selector values as glob wildcards (prefix/suffix/middle, POSIX-shell semantics — `*` matches any chars including `/`). Selectors without `*` stay literal equality. Backward-compatible: all existing standing grants match identically.
- New `selectorValueMatches(granted, required)` helper exported from `@openape/grants`.
- Free-idp UI: full-screen 3-step wizard on `/agents/:id` lets users author scoped standing grants by typing an example command, editing typed slots with Literal/Any/Pattern modes (live glob preview), and picking risk cap / duration / reason.
- The previous "Safe Commands" grid and "Scoped Standing Grants" list are merged into a single "Erlaubte Commands" card on the agent detail page; defaults keep their shield-check icon + inline toggle.
- `@openape/idp-test-suite` adds an E2E glob-coverage scenario under `suites/safe-commands.ts` that seeds a prefix-globbed path SG and asserts covered vs. uncovered requests.
