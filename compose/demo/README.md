# App guides — captured from live E2E runs

Every interactive app's `/docs` guide is generated from a real end-to-end run on
the local stack: a headless browser drives the actual flow, the step captions are
the documentation, and screenshots are captured as it goes. The guide can't drift
from the product because it *is* the test run.

## Regenerate everything

```bash
pnpm guides           # = compose/demo/run.sh
```

This brings the stack up, resets the IdP to a clean slate, mints a registration
token for the demo user, runs the stories, then:

1. writes screenshots + a manifest under `docs/local-stack/`,
2. `compose/distribute-docs.mjs` fans them out to each app's
   `apps/<app>/docs/stories.json` + `public/docs/screenshots/` and rebuilds that
   app's `/docs` guide,
3. `apps/docs/scripts/aggregate-guides.mjs` collects them into the **Apps**
   section on docs.openape.ai (`content/5.apps/` + `public/guides/`).

Each app then serves its own guide at `https://<app>.openape.test/docs`, and all
of them are aggregated at `https://docs.openape.ai/apps`.

## Add a guide for a new app

1. Write `compose/demo/stories/<app>.mjs` — export `default async ({ kit, page, <APP>, EMAIL })`.
   Use `kit.story({ app: 'openape-<app>', category, id, title, intro }, s => …)`
   with one `s.step(title, { do, shot }, caption)` per screenshot. Helpers:
   `fillEmail`, `click`, `approveIfPrompted` from `story-kit.mjs`.
   - Captions are **product copy** — present tense, reader-facing, no test-speak.
   - Agent-facing apps forge a CLI token with `node:crypto` (HS256, `iss`=`aud`=
     the SP's `client_id`, secret = the `x-dev-secret` from `local-stack.yml`)
     and upload over `page.request` — see `testrun.mjs` / `pr.mjs`.
2. Register it in `run-stories.mjs` (import, add the `<APP>` URL to `ctx`, append
   to the run loop).
3. Copy the `/docs` scaffolding from another app (`scripts/build-docs.mjs`,
   `app/components/docs/GuideShell.vue`, `app/pages/docs/`) and swap the brand
   name; the theme colour is picked up from the app's own config.
4. Add the app to the `APPS` list in `apps/docs/scripts/aggregate-guides.mjs`.

## Determinism caveat

`installDeterminism` freezes the **browser** clock and `Math.random`, so
client-side rendering is stable. It cannot freeze **server** timestamps —
`created_at` is stamped by each app when the story creates a team / plan / run,
so any screenshot that shows an absolute time (a plan's "Updated …", a PR's
created date) changes run to run. That churns ~12 of the ~50 screenshots even
when nothing about the product changed.

Treat the screenshots as regenerable artifacts: `docs/stories.json` (the
captions and structure) is the source of truth to review in a diff; commit
screenshot updates when the flow or UI actually changed, not for a
timestamp-only delta. Freezing server time would need a container-level clock
shim (e.g. libfaketime) and isn't worth it for a cosmetic diff.
