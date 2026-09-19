# Grant brokering verification — 2026-09-19

Protocol source: 819bb3cc54b97fa6f0456867b933f07a75b03e88; native PR https://repos.openape.ai/patrick/protocol/pulls/1; merge 25b6d89b8fc6c21f171df6c78cf6a30ca9f1ff99. Canonical and configured Forgejo main now match. Thirteen standalone schema checks pass.

Implementation baseline: fe4432e5f0863c64de32de3eb6c8da47c776b70b. Branch: feature/issue-1354-federated-grants. All implementation changes were created in this clean worktree; existing owner profiles remain untouched.

## Checks
- Full monorepo lint: 51 tasks pass; existing JSDoc warnings remain.
- Full monorepo typecheck: 72 tasks pass.
- @openape/grants: 257 tests pass, all existing coverage thresholds pass.
- @openape/nuxt-auth-idp: 644 tests pass.
- openape-free-idp: 329 tests pass.
- @openape/pods: 261 tests pass.
- @openape/apes: 632 tests pass, eight pre-existing cases skipped.
- @openape/protocol-conformance: 13 tests pass, including emitted broker claims and provenance.
- Built IdP module, IdP app, apes and packaged Pods successfully.
- One focused native packaged provider-consent/layout test passes; four unrelated cases excluded by the explicit test-name filter. Both screenshots inspected. No full E2E suite completed locally. The default pre-push hook unexpectedly started the full contract: openape-e2e completed, then the process tree was stopped during openape-free-idp. Subsequent pushes skip only that local hook because Patrick excluded full local E2E; native required CI remains mandatory.

The durable SQLite suite checks owner-only visibility without a local agent account, replay rejection, exactly one successful consumption across concurrent independent SQLite connections, an atomic 100-request owner inbox bound, durable audit associations, revoked reusable tokens and immutable enrollment. HTTP lifecycle fixtures use separate signing keys and exercise owner-only approval, unauthorized reads/approval, delegated callers, cross-origin browser writes and original-owner signatures. Network tests reject private/mapped addresses, pin the DNS result for TLS and map malformed provider metadata to protocol-required 503 responses. Desktop tests verify the owner bearer never reaches the agent provider, receipt isolation and unchanged existing Pod bindings.

Exact local commands (all after `. ./scripts/activate-node.sh`): `pnpm lint`; `pnpm typecheck`; `pnpm --filter @openape/grants test`; `pnpm --filter @openape/nuxt-auth-idp test`; `pnpm --filter openape-free-idp test`; `pnpm --filter @openape/pods test`; `pnpm --filter @openape/apes test`; `pnpm --filter @openape/protocol-conformance test`; `pnpm --filter openape-free-idp build`; `pnpm --filter @openape/pods build`. Native check: `pnpm --filter @openape/pods exec vitest run --config vitest.electron.config.ts e2e/onboarding.test.ts -t 'broker provider settings'` after fixture packaging. Permanent federation tests retain security and protocol contracts; no temporary test removal.

## Deployment boundary
Read-only DNS checks return no A/TXT records for pods.openape.ai, and the configured host has no Pods IdP service. docs/operations/grant-brokering.md describes the required separate database, secrets, issuer, HTTPS and DDISA discovery. Implementation verification does not claim production federation. No provider consent, real agent or grant was created against a live account.

## Evidence

https://testrun.openape.ai/r/8gjF_LKzq1Uv94XESTSaLysj

## Delivery
Implementation [PR 69](https://repos.openape.ai/patrick/monorepo/pulls/69), code source `40aeb4ba314bda319b0dd4ced2b4e377d42ab00e`; exact-source external checks and local installation are pending. The pre-commit shared unit contract passed all seven gates across 51 workspaces (`.openape/check-results/1789812760148-fe4432e5-unit/summary.json`, staged implementation). Existing schedules and user data must be retained.
