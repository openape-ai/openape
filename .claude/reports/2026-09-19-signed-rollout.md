# Pods server rollout and signed internal installation

## Source and review

- Issue: https://git.openape.ai/openape-ai/openape/issues/1354
- Protocol: https://repos.openape.ai/patrick/protocol/pulls/1; merge `25b6d89b8fc6c21f171df6c78cf6a30ca9f1ff99`.
- Grant implementation: https://repos.openape.ai/patrick/monorepo/pulls/69; merge `e3bb38e5f48420325f245e7eac6bc6a39371288f`.
- Deployment: https://repos.openape.ai/patrick/monorepo/pulls/70; source `ee497fe81eb31eedea3f65782524ac82c4c2729b`, merge `ce1a8fb87536fb471bbb01dce16884cf098be9d9`. Source and merge trees match. Required CI, E2E and layout checks passed for that source.
- Internal signing: https://repos.openape.ai/patrick/monorepo/pulls/71; artifact source `ad93686159a301a9b715a15cdba5cc0d3b20368b`. The native PR contains final external check and merge receipts.
- Authorized rollout plan: https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2WMRWHCG8Y1NFB9EPKE0C3S

## Live services and preservation

Both IdPs run tested images pinned to `prod-ce1a8fb8`. The prior owner image is `prod-59e0de19`. The new provider uses port 3027, its own persistent database/session secret/signing key and exact issuer/agent domain. The authoritative A and `_ddisa.pods` TXT records resolve correctly. The dedicated watched Traefik file reuses wildcard HTTPS and rejects public human registration.

Health and discovery pass at both issuers. Each advertises Grant Brokering 1.0. Same-origin unauthenticated connection/grant writes return 401; missing owner Origin returns 403. Registration at the agent provider returns 404. Published signing keys differ.

The existing key store creates its first key lazily when signing. First provisioning therefore initialized one independent Ed25519 key on the new provider using Node crypto and the existing `signing_keys` JWK schema, with a transaction that refuses any pre-existing key. No key material left the container or entered Git/logs. Restarting only the new provider cleared its initially empty key cache. Future deployments retain that database and key.

The owner database retained all 22 user/agent rows, 12 credential rows and 2 signing-key rows byte-for-byte. All 47,603 predeployment grant IDs and request payloads remain; ordinary live activity added further grants. The new provider has 0 users, 0 credentials, 0 grants and 1 signing key. No real account connection or grant was created for testing.

Server rollback: `/home/openape/prod/backups/pods-rollout-20260919-111207` on the configured `chatty.delta-mind.at` SSH alias. It contains an online SQLite backup, integrity check, original environment/compose and aggregate before/after receipts. Keep the current live DB during ordinary image rollback; restoring the snapshot would discard subsequent activity.

## Signed Mac installation

- Developer ID: `Developer ID Application: Delta Mind GmbH (Q994DN23WB)`.
- Notary profile: `delta-mind-notary` (existing keychain profile; no secret copied).
- App submission: `8b3a24b2-4754-4dd3-a908-8a1e44a9e8a5`, Accepted and stapled.
- DMG submission: `5acc523d-8c59-4926-b853-d6172a3c6574`, Accepted and stapled.
- DMG: `OpenApe-Pods-0.1.0-arm64-signed-local.dmg`.
- SHA-256: `7ce3aefd648d515a3a75c11eeee331cd094141cfa34aa86d5947dd55bfaac2c6`.
- Installed: `/Users/patrickhofmann/Applications/OpenApe Pods.app`.
- Paired previous app/profile: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/2026-09-19-132008`.
- Private local receipt: `/Users/patrickhofmann/Library/Application Support/OpenApe Pods Rollback/signed-rollout-delivery/installation.json`.

The installed app passes strict deep signature verification and Gatekeeper (`Notarized Developer ID`). Four Pods, 107 runs, schema 19, the default owner and the single enabled schedule remain. All 13 encrypted credential files and 54 stable database tables are unchanged; only startup inventory settings refreshed. Startup produced no error markers. No production schedule was activated or disabled.

This is the authorized internal installation. `releaseReady` remains false. The preliminary native dependency inventory found incomplete publisher license texts; external candidate/public distribution review remains pending. The signing flow does not mark those gates passed.

## Verification

Full lint (51 workspaces), full typecheck (72 tasks), Free IdP/Pods builds, 5 deployment tests and 263 Pods unit/component tests passed. Precommit unit gates passed. Retained tests cover mixed first/existing deployment rollback and clean-build/public-license signing boundaries.

`pnpm --filter @openape/pods test:distribution --signed-local` passed: actual read-only mounted DMG, valid signature/staple/Gatekeeper, isolated profile, synthetic identity and harmless deterministic run. The screenshot was inspected. The signed Codex binary starts and its offline model catalog includes GPT-6 Astra. No real mail, LLM or Telegram test call and no full local E2E suite. Required external suites remain governed by the native PR checks.

Operational logs are retained under `/tmp/pods-server-deploy.log`, `/tmp/pods-live-protocol-verification.json`, `/tmp/pods-sign-package.log`, `/tmp/pods-signed-distribution-check.log` and the private local installation receipt. Durable public-safe evidence is linked from the native PR delivery comments and the rollout plan.
