# verify — openape-monorepo

Fail-fast, ascending cost: **lint → typecheck → build → test**. Stop and fix on the
first red step, then start over. pnpm + Turborepo; scope to the touched package/app
with `--filter` so you don't rebuild the world.

```
pnpm lint                                  # ESLint (@antfu config) — all, or:
pnpm turbo run lint --filter=<pkg-or-app>
pnpm typecheck                             # or: pnpm turbo run typecheck --filter=<pkg>
pnpm turbo run build --filter=<app>        # build the touched app (DoD requires it for app changes)
pnpm turbo run test --filter=<pkg>         # Vitest
```

**Definition of Done (from the monorepo CLAUDE.md):** `pnpm lint` and `pnpm typecheck` must be clean before any commit. For **app** changes also `pnpm turbo run build --filter=<app>` and check locally. For **Nuxt-module** changes, typecheck the playground too (`pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp`). Never verify via workarounds; if the real flow can't run, escalate.

Code style is Composition API + `<script setup>` + @nuxt/ui + Tailwind (NOT iurio's Options API/Bootstrap-Vue) — match the surrounding code.

## DDISA protocol compliance (mandatory gate for protocol-relevant changes)
If the task touches DNS discovery, the auth flow, JWT claims, the Grant/Delegation API, error format, or well-known endpoints (packages `core`/`auth`/`grants`, modules `nuxt-auth-*`, `apes`, `apps/docs`): check the change against the DDISA spec (`openape-ai/protocol`). **Any spec deviation must be surfaced — escalate and ask, never silently diverge.** (CLAUDE.md "DDISA Protocol Compliance".) The security checklist there applies to auth/grants/session/endpoint changes.

## UI changes — visual review via Coolify PR-preview (post-PR)
There's no local cypress here. A visible UI change in a web app (free-idp / troop / chat / docs) is verified on the **Coolify PR-preview URL** that deploys from the PR (see memory `reference_coolify_pr_preview_per_app`):
1. Open the PR first (`pr.md`), wait for the preview to deploy, get its URL.
2. Screenshot the changed view **Desktop (1440×900) + Mobile (390×880)** via headless Chrome.
3. Dispatch the **`visual-qa-reviewer`** agent on the "after" screenshots with the requirement. Proceed only on `VERDICT: APPROVED`; if REJECTED, push a fix to the same branch and re-check.

For non-UI tasks (packages, server logic, config), the turbo gates above are the whole verify — no preview needed. Prefer a non-UI task for the first E2E run.
