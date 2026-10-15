# Reports UI verification

Issue: https://repos.openape.ai/patrick/monorepo/issues/1486

Approved scope: Plan revision 1, milestone C. Frozen source baseline:
`95d1083abfb9de07ad8edf5bb16c71e06207c5fd`.

## Assertion inventory before migration

| Existing source | Observable contract | Intended disposition |
| --- | --- | --- |
| `tests/layout/report-page.test.ts` | Real report data renders; large screenshots fit; small frames hug images; window dots keep geometry; code scrolls; lists indent | Keep every assertion, load production CSS |
| `tests/layout/document.test.ts` | Edition text escapes markup, series disclosure, constrained document iframe, sandbox attribute | Strengthen real disclosure/link/height checks; attribute checks are not isolation proof |
| `tests/layout/briefing.test.ts` | Escaping, missing-source warning, earlier edition, appearance selector, safe external links, deduplicated content | Keep; extend actual light/dark geometry at wide/narrow viewports |
| `tests/layout/html-report.test.ts` | Explicit trust, fetch boundary, sandbox/referrer attributes, fresh consent per version, viewport fill, denied viewer | Keep; add real theme, pending/error and version navigation geometry |
| `e2e/briefing.e2e.test.ts` authenticated viewing | Real callback on canonical/alias origins, CSRF denial, route/version wiring, browser errors, responsive appearance | Only move theme/width matrix after passing replacement and mutation counter-proof |
| `e2e/html-documents.e2e.test.ts` active HTML | Publication, exact bytes, authenticated route, separate content origin, parent/cookie/storage denial, offline calculations, external image delivery, access revocation, expiry | Only move outer shell theme/width/height matrix after replacement proof; all content/security behavior remains real |
| `e2e/briefing.e2e.test.ts` client documents | Private/historical document delivery, CSP/sanitization, embedded image decoding, actual iframe layout | Keep: hosted document contents are not represented by `about:blank` component fixtures |
| `e2e/proof-link.e2e.test.ts` | HTTP publication, immutable versions, owner separation, legacy privacy rollback | Keep unchanged |
| `e2e/cli-roundtrip.e2e.test.ts`, `e2e/reports-cli.e2e.test.ts` | Actual CLI exchange, publication/receipts, invalid credentials, policy, team and compatibility routes | Keep unchanged |
| `e2e/interactive-boundary.e2e.test.ts`, `e2e/restore-readiness.e2e.test.ts` | Actual browser isolation/egress, Fetch Metadata, fail-closed policy journal | Keep unchanged |

The executed replacement proofs and retained acceptance are recorded below.

## Runtime boundaries

The browser suite mounts production Vue components and imports
`app/assets/main.css` through the installed Nuxt UI Vite plugin (including its
Tailwind compiler). No reset, tokens or measured controls are copied into setup.
The route boundary renders anchors with the supplied destination; `$fetch`,
`useRoute`, `useFetch` and the auth composable receive synthetic data. Those seams
do not prove authentication, server sanitization, navigation or durable effects.

Browser instances use isolated Playwright contexts and a strict port (5483).
Focused runs use one worker and serial browser files. They need installed Chrome,
not an app backend, IdP, Electron or production credentials. Synthetic screenshots
and logs live under `.artifacts/ui-test-migration/` and are not committed.

For integrated checks, set `TMPDIR` to a new directory beneath this worktree's
`.artifacts/` so the shared lifecycle helper cannot clean another checkout's
tracker or fixtures. Its disposable app/IdP databases, ports and browser contexts
must stay local to this checkout. Close only processes started by this invocation.

## Replacement proof and retained acceptance

The following UI-only matrices were removed only after the named replacement
passed, a targeted temporary mutation failed with the expected assertion, the
source was restored byte-for-byte, and all 25 browser cases passed again.

| Removed assertion | Passing replacement | Observed counter-proof |
| --- | --- | --- |
| Briefing E2E `data-theme` and no horizontal overflow at 390/1440 px, light/dark | `briefing.test.ts`: `renders the real briefing page at $width px in $theme without horizontal overflow` | `.paper` min-width 900 px failed both narrow cases (900 > 390); changing dark paper to light failed both dark cases. The replacement also checks the computed color, not only the attribute. |
| HTML E2E outer shell no horizontal scroll | `html-report.test.ts`: `fills the $width px $theme shell below the bar without page scroll` | `.reader` min-width 900 px failed both narrow cases (900 > 390). |
| HTML E2E outer shell fills viewport without page scroll | Same four HTML shell cases | `.reader` height 120dvh failed all four (1012.8 > 844 / 1200 > 1000). |
| HTML E2E outer shell light/dark background | Same four HTML shell cases | Dark `--mat` replaced by light failed both dark cases. |

Additional counter-proofs: removing the production CSS entry failed all four
HTML shell cases; making the legacy document iframe 900 px tall failed its viewport
bottom assertion (1040 != 844); removing screenshot max-width constraints failed
the existing phone screenshot assertion (1202 > 390). This detects observable
regressions with the full preflight present rather than omitting real styles.
Raw commands, output and mutations are retained in the private evidence artifact.

The real briefing test still performs DDISA callbacks on both canonical and alias
origins, checks CSRF denial, navigates between immutable versions and rejects
browser errors. It captures both authenticated routes. The active-HTML integration
still publishes and reads exact bytes, opens the actual hosted document, verifies
its content origin and parent/cookie/storage denial, decodes image/font/SVG/canvas,
changes embedded controls offline, checks access/capability revocation, optional
external image delivery and expiry. Legacy document security/iframe-content layout,
CLI journeys and all other suites remain unchanged.

The only production edit exposes the unchanged `app/app.config.ts` object directly
so both Nuxt and the browser Vite pipeline consume the same `ui` configuration.
Reports' measured chrome currently uses native controls and app CSS tokens; no
Nuxt UI component is stubbed or substituted. Nuxt-only routing/auth/transport seams
are explicit in the harness. No package manifest, dependency, root gate, shared
module, CI setting or deployment changed.

## Commands and handoff

From the repository root, activate the pinned toolchain in every shell:

```sh
export OPENAPE_PNPM_BIN=/Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin
export PATH="$OPENAPE_PNPM_BIN:$PATH"
. ./scripts/activate-node.sh
pnpm run doctor
```

Fast UI iteration (no app/IdP startup):

```sh
pnpm --filter @openape-testrun/app test:layout --maxWorkers=1
pnpm --filter @openape-testrun/app test:layout tests/layout/html-report.test.ts --maxWorkers=1
```

Retained integration commands (request the shared heavy-check slot first):

```sh
mkdir -p "$PWD/apps/openape-testrun/.artifacts/integration-tmp"
export TMPDIR="$PWD/apps/openape-testrun/.artifacts/integration-tmp"
export TURBO_ENV_MODE=loose VITEST_MAX_WORKERS=1
pnpm exec turbo run build --filter=@openape/nuxt-auth-sp --filter=@openape/nuxt-auth-idp --filter=@openape/ape-testruns --concurrency=1
pnpm --filter @openape-testrun/app build
pnpm --filter @openape-testrun/app test:e2e e2e/briefing.e2e.test.ts e2e/html-documents.e2e.test.ts --maxWorkers=1 --fileParallelism=false
```

Run the unchanged CLI/security suites through `test:e2e` when those boundaries
change; the two named files above are the directly affected real acceptance.
The normal push hook owns the affected unit/lint/typecheck gate. Do not run a
second complete gate before it. No deployment or CI reactivation is part of this
migration.

The frozen baseline command was `pnpm --filter @openape-testrun/app test:layout
--maxWorkers=1 --browser.fileParallelism=false --browser.api.port=5483
--browser.api.strictPort`. A warm-up passed 13 cases in 1.56 s; a second run passed
13 in 1.44 s Vitest / 2.05 s wall clock including pnpm and browser startup.
The expanded suite now also captures evidence and runs 25 cases, so lower test
counts or a speedup are not claimed. Both use the same installed Chrome, Node
24.15.0 and pnpm 10.29.3. Time Machine/system background load was present.

The linked issue and implementing PR carry the final source SHA, normal push gate,
actual integration/build results and private Test Run URL. The Test Run includes
exact commands, cache/worker settings, timings, inspection digests and limitations.
`.artifacts/ui-test-migration/` contains local receipts; do not treat this document
or a sandbox attribute as proof that an unexecuted boundary passed.
