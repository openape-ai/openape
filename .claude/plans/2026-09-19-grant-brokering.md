# Plan: Federated agent identities and user-owned grant decisions

## Purpose and approval
Patrick approved implementation on 2026-09-19 after agreeing this flow: an agent has an identity at a Pods IdP; its human owner keeps their existing DDISA identity and grant authority; the human authorizes Pods once to submit requests, then approves individual actions at their own IdP. Protocol changes precede implementation. Request mediation does not delegate execution authority or signing authority.

## Repositories and baseline
Protocol: `/Users/patrickhofmann/Companies/private/repos/openape/protocol.worktrees/pods-grants`, branch `feature/issue-1354-grant-brokering`, canonical `patrick/protocol`, base 678a1e2c0e01c07d7122711e04d8ffe4264c0c9b. No dedicated vault mapping exists; the general index and verified cross-project protocol references apply.
Implementation: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-conversation`, branch `feature/issue-1354-federated-grants`, canonical `patrick/monorepo`, base fe4432e5f0863c64de32de3eb6c8da47c776b70b. Tracking issue: https://git.openape.ai/openape-ai/openape/issues/1354.

Core packages: `packages/core` (wire types/discovery), `packages/grants` (authorization tokens and stores), `packages/auth` (identity), `modules/nuxt-auth-idp` (grant APIs, consent and broker service), `apps/openape-free-idp` (persistent stores and notification routing), `packages/apes` (executor verification), `apps/openape-pods` (identity provisioning/account UX).
Use `. ./scripts/activate-node.sh` in every shell before package commands. `pnpm run doctor` passed on the clean starting tree. Existing local tests prove the old local-requester requirements: 25 tests across grants-list-auth, grants-approve-authz, bearer-auth, grant-request-auth.

## Contract decisions
- Distinguish the identity issuer, owner decision issuer, and request broker. Bind each external identity to its issuer and subject.
- A human explicitly enables a broker connection at their decision IdP. Trust is per owner, exact broker issuer and agent domain, never a global bypass or a wildcard approver.
- The broker authenticates each agent and checks its owner before submitting a signed request. It cannot approve, widen, or independently sign execution grants.
- The decision IdP stores external requester references within grants rather than provisioning local agent accounts. Listing, notification, approval, token retrieval and consumption consistently resolve the external owner and connection.
- Original user-IdP grant signatures survive forwarding. Executors pin the owner-authorized decision issuer and verify agent, host, command, lifetime and consumption there.
- Revoking a broker connection blocks new requests, token issuance and further consumption of its grants, including previously approved reusable grants. Re-enabling creates a new connection identity and does not resurrect prior authority. Already-started commands cannot be recalled.
- Existing local grants retain their behavior. Existing Pods and keys are not reassigned automatically. New setup uses federation only when the services advertise support.
- No real email/model/Telegram tests, no schedule activation, no user-data reset. Synthetic fixtures exercise two independent issuers and a local executor.

## Milestones
1. Protocol profile: define discovery, human consent, authenticated request forwarding, claims, identity/owner mapping, canonical status, revocation, errors and conformance examples. Update related schemas and documents; validate positive and negative examples. Commit/review protocol before production implementation.
2. Shared contracts and decision IdP: durable owner-scoped connections, strict signed broker authentication/replay handling, external grant routing throughout lifecycle, human consent UI, and notifications without local agent records. Preserve direct paths.
3. Agent IdP and Pods: external human sign-in and binding, agent enrollment, request/status/token mediation, account connection UX; separate identity authority from grant authority in desktop contracts and runtime. Keep private agent keys local.
4. Executor: explicit owner-authorized grant issuer, original signature verification and authoritative consume; reject substituted identities, commands, audiences, revoked connections and duplicate one-shot consumption.
5. Verification and delivery: full lint/typecheck, affected builds and meaningful existing unit/component/native suites; mandatory native PR gates; clean reviewed PRs, protocol first, then implementation. Build and locally install only after passing checks, retaining a paired old app/profile rollback. Remote service rollout requires verified configured hosting; never claim deployed capabilities merely because code exists.

## Acceptance
A human authorizes a broker once; two newly enrolled agent identities can request their own grants without local requester rows at the decision IdP. Only that human sees and decides those requests. Broker and agent cannot self-approve or switch owners. A permitted harmless command executes only after approval; denial, expiry, connection revocation, identity substitution and reused one-shot grants prevent execution. Existing local grants still work. UI names the agent and its Pods provider separately from the deciding account. No secret is exposed to chat or renderer.

## Rollback
Features are additive and capability-advertised. Preserve old connections and keys. Retain database/app backups before local installation; disable new broker connections through revocation if rollout fails. Never roll an old binary onto a migrated profile without its matching backup.

## Progress
- 2026-09-19: Approved architecture captured; clean repositories and current canonical bases verified; implementation worktrees prepared.
- Protocol: complete. Native PR https://repos.openape.ai/patrick/protocol/pulls/1 merged as 25b6d89b8fc6c21f171df6c78cf6a30ca9f1ff99; 13 positive/negative schema checks passed.
- IdP, Pods and executor: implemented. Full lint/typecheck, 2,135 unit/component/conformance tests and focused packaged UI verification pass. Review, exact-source gates and local delivery pending. Public pods.openape.ai has no DNS/service; production rollout is separate from these implementation checks.

## Discoveries
The current grant lifecycle depends on local user rows at list, notification, approval and consumption. Replacing only request authentication would leave the flow broken. The current protocol forbids delegation chaining; request mediation therefore remains distinct from onward delegation of execution rights.

## Outcome
Pending.
