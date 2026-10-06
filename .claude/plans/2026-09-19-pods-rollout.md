# Pods production rollout and signed macOS candidate

## Purpose and authorization

The user authorized server rollout and Apple Developer signing on 2026-09-19. The merged Grant Brokering profile is ready for deployment. Deliver a separate agent provider at pods.openape.ai, update id.openape.ai, and locally install a Developer ID signed/notarized Mac candidate while preserving existing data and schedules.

## Repository and execution

Canonical repository: https://repos.openape.ai/patrick/monorepo.git. Issue: https://git.openape.ai/openape-ai/openape/issues/1354. Worktree: /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-conversation. Branch: feature/issue-1354-pods-rollout, based on e3bb38e5. Configuration changes use a native PR and exact-source external CI before merge. Activate Node with `. ./scripts/activate-node.sh` in each shell.

## Milestones

1. Add the Pods IdP target and Traefik route. Use a separate shared directory/database/session secret/signing key, port 3027, issuer https://pods.openape.ai, agent domain pods.openape.ai. Block public human registration on that host. Preserve the owner's environment and database. Connect via the configured chatty SSH alias and execute deployment operations as the existing openape service user.
2. Verify full lint/typecheck, build and relevant tests; review the native diff and merge only with required exact-source CI. Local full E2E is excluded by the user; external required CI remains mandatory.
3. Snapshot production configuration and SQLite using online backup, record stable identity/key counts and hashes without exposing values. Build, smoke-test and push canonical images using deploy-image. Add DNS A and DDISA TXT records, install the isolated watched Traefik file, deploy the two services, and verify HTTPS health, discovery, independent JWKS and rejection of unauthenticated writes.
4. Review packaged/native license notices, bind evidence to the exact source and dependency lock, build a signed candidate with Developer ID Application: Delta Mind GmbH (Q994DN23WB) and keychain profile delta-mind-notary. Notarize and staple both app and DMG. Verify Gatekeeper, mounted-package startup and relevant harmless boundaries. Full public-release gates remain pending where not exercised.
5. Pair a fresh app/profile backup, wait for no active run or imminent scheduled job, install the candidate, and compare persistent business data and encrypted credential hashes. Existing schedules retain their state. Record hashes, submissions, rollback locations and final URLs.

## Rollback

Retain the current owner image prod-59e0de19 and a consistent predeployment DB backup. Health failure restores the previous image; a failed first Pods deployment stops its new service. Remove only the new Pods route/DNS records if provisioning fails; do not reset shared edge configuration. For local startup/data failure restore the paired app/profile snapshot. No production mail, LLM or Telegram probes; no new account consent, grants or schedule activation.

## Progress

- 2026-09-19: Clean source and live compose equality verified. Existing Developer ID and notary profile available. Dedicated Pods domain/service absent; port 3027 unused.
- Implementation and evidence pending.
