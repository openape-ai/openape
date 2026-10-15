# Git/Issues UI verification migration

Approved Plan revision 1; frozen base `95d1083abfb9de07ad8edf5bb16c71e06207c5fd`.
Only this application is editable. Integration assertions remain until a named
browser replacement passes, a targeted mutation fails, and restoration passes.

## Initial assertion inventory

| Existing test | Observable contract | Boundary retained |
| --- | --- | --- |
| `e2e/issues.layout.test.ts`: creates/previews/discusses/filters/triages | Actual controls, Markdown preview, keyboard submits, labels/assignment, close/reopen, narrow/wide overflow and metadata stacking | Real creation/comment after reload, URL search reload/back, route wiring and server-rendered preview |
| product selection across login | Preselected product, reporter presentation at two widths | Real login/callback return path, participant access, revocation |
| reciprocal related links | Issue/PR links and merged state at two widths | Real relation persistence, merge and manual issue resolution |
| external-code issue home | Hidden native code/pull/mirror controls and responsive header | Real repository creation, access route and redirect |
| migrated comment | Provenance, locked discussion, narrow/wide view | Real legacy login/anchor continuation and protected download |
| `tests/issue-ui.test.ts` | Loading/empty, preview error draft, idempotent retry, edit/routing/policy conflicts, permissions presentation, access revocation, stale requests, triage and links | Existing unit contracts retained during browser migration |

Browser transport responses are deterministic presentation fixtures. They do not
prove server Markdown sanitization, authorization or durable persistence.

## Browser boundary

`tests/layout/setup.ts` installs the official `@nuxt/ui/vue-plugin` and imports
`app/assets/main.css`. The official Vite plugin generates Tailwind/Nuxt UI styles;
`app/theme.ts` supplies the same theme to the application and the test runner.
All issue components and Nuxt UI controls remain real. Only `$fetch`, Nuxt route
state, navigation and the NuxtLink routing boundary are deterministic adapters.
Unexpected transport requests fail instead of returning a catch-all response.
The existing unit suite remains in the automatic unit gate; browser cases are
excluded from it and belong to the explicit manual layout command.

The browser API binds `127.0.0.1:5481` and HMR uses port 5491, with strict
collision failure. A listener on that exact IPv4 address caused an explicit
`Port 5481 is already in use` failure before tests; after releasing the listener,
the creation case passed. No fallback port or foreign process cleanup is used.
Chromium uses a disposable browser context/profile. Each case unmounts its Vue
root and resets globals; no real account, backend, database or identity is read.
Screenshots and failure attachments are ignored local artifacts. Geometry is
measured at 390×844 and 1440×1000. Screenshot height then expands to show the
complete iframe body; this does not change the width used for layout assertions.
Dark is the application's default. One explicit light-mode editor case verifies
that real Nuxt UI tokens follow the selected mode.

## Replacement proof

The 13 browser cases retain scenarios from the original browser journey and the
existing 15 unit interaction contracts. The unit tests remain unchanged.

- `creates by keyboard, previews Markdown and retains the draft and retry key after failure`:
  actual preview request, real controls, heading, typography, UI colors, Markdown
  overflow containment and keyboard submission. Hiding `IssueMarkdown` made this
  test fail; forcing a fresh creation key also failed the retry assertion.
- `comments, assigns labels and closes/reopens with metadata below discussion on phones`:
  comment submission, assignment, labels, state controls, two-column desktop and
  stacked phone geometry. Restoring two columns in the mobile production CSS
  failed the vertical-position assertion.
- Repository/overview filter cases, reporting, imported detail and external header:
  corresponding named 390/1440 layouts plus request/visibility assertions. A
  temporary 600px mobile minimum width in the production stylesheet failed all
  these named overflow checks, including the issue-linked view. A separate
  mutation of the full PR page width failed `pull-linked mobile overflow`.
  The PR test mounts the real production page and its complete child tree.
- Preview authentication failure, edit conflict, audience review, loading/empty,
  participant visibility and light mode cover important existing component states
  with real controls. Mocked preview HTML proves rendering only; server rendering
  and sanitization remain in `tests/issue-api.test.ts` and real acceptance.

All mutations were temporary and restored. The subsequent complete browser run
passed. Counterexample logs are under `.artifacts/ui-test-migration/mutation-*.log`.

## Baseline setup limitation

The first unchanged `test:layout --maxWorkers=1` run exited 1 after 301.46 seconds:
IdP startup could not load this worktree's `packages/grants/dist/index.js`.
All five tests were skipped; this is not a passing baseline or a speedup estimate.
The lifecycle stopped its own fixture processes. The required serial prebuild was
resolved through `scripts/check.mjs` for Git and the IdP example: auth, core, grants,
nuxt-auth-idp, nuxt-auth-sp, shapes and unstorage-s3-driver. No output is borrowed
from another worktree, and no startup timeout is increased.

## Retained integration ownership

The real browser journeys retain application routing, real DDISA login/callback
and return continuation; durable issue/comment creation across reload; URL filter
reload/back; actual label/assignee/state updates; explicit reciprocal PR relations
and exact-SHA merge without implicit issue closure; external-home creation/access
routing; and legacy comment continuation with an authenticated file download.

`e2e/issues.e2e.test.ts` retains seven real API/CLI journeys: login/exchange and
idempotent persistence, cross-site/stale-version rejection, reporter/triage access,
PR relation and merge, external authority fences, migration/private downloads and
pilot-size private pagination. `tests/issue-api.test.ts` retains actual Markdown
sanitization, permission and migration-fence coverage. UI transport fixtures never
substitute for these boundaries.
