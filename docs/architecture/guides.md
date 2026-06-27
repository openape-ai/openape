# Guides from E2E (CLI + Browser, parity-checked)

The idea: every capability is exercisable two ways — via the **CLI** and in the
**Browser** — and a single E2E run emits a readable how-to that shows both side
by side. Because the guide is generated from a passing run (real CLI output,
real screenshots), it can't drift from the product.

## Pieces

- **Scenario spec** — `apps/openape-testrun/e2e/scenarios/proof-link.ts`: the
  ordered steps with their doc-prose captions and the equivalent CLI command,
  written once. (Captions are product copy — present tense, reader-facing.)
- **Capture** — `apps/openape-testrun/e2e/proof-link-guide.e2e.test.ts`: boots
  the app, uploads the scenario's run, drives the public `/r/<slug>` page and
  screenshots it at three viewports (desktop/tablet/mobile), then emits
  `.guide/proof-link.json`. The screenshot assertions fail the run if the page
  doesn't render — so a broken UI can't produce a green guide.
- **Generator** — `scripts/build-guide.mjs`: turns the JSON into a single
  self-contained HTML file (CLI command + output beside the browser screenshot
  with a viewport toggle, screenshots inlined as data URIs). Run with
  `pnpm --filter @openape-testrun/app guide`. **Verified** — produces the
  CLI-beside-Browser layout with the 3-viewport toggle.

## Parity, for free

Both tracks read the same scenario spec, so a step that exists in one and not
the other is a visible gap. Extend `steps[]` with `browserPath` to add a browser
shot; omit it for CLI-only steps.

## Status / blocker (2026-06-27)

The **generator is done and verified**; the **live capture is blocked in both
environments** by Nitro app-build issues, so a green CI-captured guide is not yet
landed:

- **Local** — `@nuxt/test-utils` `setup({server:true})` does a production Nitro
  build whose bundled libsql native binding is broken (`databaseOpen` "not enough
  arguments"); DB endpoints 500. See the SP-app-e2e-harness memory.
- **CI runner** — `.forgejo/workflows/ci.yml` deliberately does **not** build the
  Nuxt apps on the runner (the Nitro `.output/server/node_modules` ELOOP symlink
  cycle, nuxt#30539). The capture's `setup({server:true})` would trigger exactly
  that app build → same class of failure.

**Recommended path:** capture against a **dev-mode** server (`nuxt dev` uses the
`node_modules` libsql, not the broken Nitro bundle) driven by a standalone
script + Playwright (browsers are cached under `~/Library/Caches/ms-playwright`).
That sidesteps both blockers and is locally runnable. The capture E2E here stays
as the realized design for whenever the Nitro app-build path is fixed.
