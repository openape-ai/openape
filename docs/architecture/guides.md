# Guides from E2E (CLI + Browser, parity-checked)

The idea: every capability is exercisable two ways — via the **CLI** and in the
**Browser** — and one run emits a readable how-to that shows both side by side.
Because the guide is generated from the real app (real CLI output, real
screenshots), it can't drift from the product.

## Run it

```
pnpm --filter @openape-testrun/app guide
```

→ writes `apps/openape-testrun/.guide/proof-link.html`, a single self-contained
file (screenshots inlined). Open it in a browser; each browser step has a
desktop / tablet / mobile toggle.

## Pieces

- **Scenario spec** — `apps/openape-testrun/e2e/scenarios/proof-link.ts`: the
  ordered steps with their doc-prose captions and the equivalent CLI command,
  written once. Captions are product copy (present tense, reader-facing).
- **Capture** — `apps/openape-testrun/scripts/capture-guide.ts`: boots the app
  in **dev mode** on a dedicated port, uploads the scenario's run, then drives
  the public `/r/<slug>` page with Playwright and screenshots it at three
  viewports — emitting the guide JSON.
- **Generator** — `scripts/build-guide.mjs`: turns the JSON into the
  self-contained HTML (CLI command+output beside the browser screenshot;
  CLI-only steps render full-width).

## Parity, for free

Both the CLI commands and the browser shots come from the same scenario spec, so
a step that exists in one track and not the other is a visible gap. Add
`browserPath` to a step for a browser shot; omit it for CLI-only steps.

## Why dev mode (not the test/prod build)

The capture uses `nuxt dev`, which loads libsql from `node_modules`. The Nitro
**production** build (what `@nuxt/test-utils` `setup({server:true})` and the
deploy image produce) bundles a libsql native binding that breaks in the test
build (`databaseOpen` "not enough arguments") and trips the runner's Nitro
`.output` ELOOP symlink cycle (nuxt#30539) — so dev mode is the reliable path
for capturing locally. See the SP-app-e2e-harness memory.

Note: a stale dev server holding the port surfaces as a hung `POST /api/runs`
("reading 'set'") — the capture script uses a dedicated port + `NUXT_IGNORE_LOCK`
and kills its own process group to avoid that.
