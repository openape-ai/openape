<span class="badge badge-info">Next: native PR review</span> <span class="badge badge-neutral">M1–M3 implemented · live API verified</span>
<p class="lead">Connect TypeSafe once with an API key. OpenApe and its connected coding agents then know that Pod scripts can use Jev for structured decisions, alongside ordinary code and optional LLM calls.</p>
<div class="callout callout-info"><p><strong>Authoring and execution are separate.</strong> Codex writes a Pod script. At runtime, that script can call Jev to classify, route or score information without starting an LLM agent. Jev does not generate code or prose. A hybrid script may explicitly call an LLM for a written summary after Jev selects the relevant inputs.</p></div>

## Purpose and proposed experience

The owner requested a familiar connection flow, like the existing Codex connection, and automatic awareness of Jev when creating Pods through Codex. This proposal adds TypeSafe to existing account setup, a small built-in script API, and capability discovery in the existing Pods MCP reference. Implementation was authorized by the owner on September 25, 2026 and is in progress in the dedicated worktree. No production Pod, credential or schedule has been changed.

<div class="grid"><div class="card"><span class="badge badge-neutral">1 · Connect</span><h3>Accounts → TypeSafe / Jev</h3><p>API key: ••••••••••••</p><p><strong>Connect and verify</strong> · Create an API key</p><p class="meta">Saved on this Mac. Used only by assigned Pods. Connecting checks access; it does not run a paid evaluation.</p></div><div class="card"><span class="badge badge-neutral">2 · Create</span><h3>“Create a Pod that sorts support requests.”</h3><p>Codex sees: <strong>Jev connected · structured decisions available</strong>.</p><p>It creates a script that uses Jev, shows which information goes to TypeSafe, and assigns the connection through the existing setup flow.</p></div><div class="card"><span class="badge badge-neutral">3 · Inspect</span><h3>Pod → Script / Permissions</h3><p><strong>Jev decisions</strong> · pinned model · connection status</p><p>History: 12 evaluations · actual model · input tokens · duration · 2 items requiring review</p><p class="meta">Questions and business thresholds remain visible in the script.</p></div></div>

These cards are a layout sketch, not working controls. Production labels use the existing English/German translation mechanism. In the account screen, use “Connect API key” for TypeSafe rather than promising an OAuth login. Existing Codex and DDISA connections remain independent.

## Milestones

### M0 · Verify the smallest vertical slice

**Goal:** settle integration boundaries before adding UI or dependencies.

1. Use the dedicated worktree and native issue recorded in Repository orientation. Refresh canonical main and inspect divergence before implementation; preserve the borrowed planning checkout.
2. Trace `RunDispatcher` startup and account/onboarding gates. Establish which Codex account checks are needed only for `context.agent.run` or internal chat, versus generic script execution. A Jev-only script must execute with the generic runtime installed and a valid OpenApe identity, without an active Codex account. This does not promise removing all bundled Codex binaries in this feature.
3. Verify a TypeSafe key through `GET https://api.typesafe.ai/v1/models`. The user enters the key in protected native UI during implementation; if a temporary manual handoff is needed, use the established secrets.openape.ai flow. Never request the key in chat.
4. Prove one small, explicitly requested live evaluation with synthetic text and each supported question type. Record the resolved model, response shape, cancellation and error behavior. Do not transmit existing mailbox data for this spike.
5. Start with a small main-process HTTP adapter using existing fetch facilities. There is no required new runtime dependency. Reconsider the official SDK only if the spike demonstrates material benefit; document packaging, license and quarantine impact before adding it.

**Acceptance:** authenticated model discovery succeeds; a harmless live evaluation produces valid typed answers; an isolated Jev-only run starts without the Codex connection; no secret appears in run output or central projection. If access to TypeSafe is unavailable, finish contract fixtures and mark the live proof pending, never as passed.

**Rollback:** remove the disposable spike and test credentials; existing Pods are untouched.

### M1 · Connect and assign TypeSafe

**Goal:** enter a key once, understand its status, and choose which Pods may use it.

- Extend the existing connection lifecycle and encrypted credential cache with provider `typesafe`. Add a narrow protected save/replace command; do not overload the existing email-based `connect` argument with a secret. A public connection view contains an ID, user label, state and verification time only.
- Extend `Onboarding.vue` in the current Accounts flow with optional TypeSafe setup, a masked input, verify/replace/disconnect actions, and a link to the official console. Jev is not a new prerequisite for completing onboarding.
- Verify with authenticated model discovery. Report invalid key, unavailable network and temporary provider failure distinctly; a timeout does not prove that a key is invalid. Do not fabricate an account email because model discovery does not return one.
- Add per-Pod assignment of the connection and a pinned model through existing resource/permission flows. Reuse resource revisions, epochs and existing identity/grant enforcement. Connecting alone grants no Pod permission. A validated replacement key updates the same connection atomically; a failed replacement preserves the working key.
- Check current authority for every request and invalidate active operations when access is revoked. Disconnect removes the encrypted credential, invalidates dependent assignments and explains which Pods need attention. Reconnection must not silently restore revoked assignments.
- Keep key entry on the native desktop for the first release. The central browser/desktop workspace shows sanitized availability and assignment metadata and points to the owning runtime for setup. Never serialize the key into commands, snapshots or activity.

**Acceptance:** connect → restart → assign → replace → disconnect is observable in the UI; failed replacement preserves the previous connection; a different Pod and a disconnected Pod cannot evaluate; snapshots and logs contain no key. Existing Codex connection and unrelated scripts still work.

**Rollback:** remove TypeSafe assignments and disable the feature; keep schema upgrades additive so old records remain readable.

### M2 · Add Jev to the script runtime

**Goal:** scripts perform decisions through `context.jev.evaluate(...)` without receiving provider credentials.

- Add request/result contracts in proposed `src/contracts/jev.ts`, a main-process adapter in proposed `src/main/connections/typesafe.ts`, and a service bridge operation `jev.evaluate`. These names are proposed, not existing APIs.
- Extend script-entry, dispatcher, service contracts and main/worker wiring. Route requests through the same Pod/run scope, assignment epoch, cancellation and authority checks used by other runtime services. Extend capability parsing with `jev.evaluate` and enforce it during validation and execution.
- Resolve connection and model from the Pod assignment. Scripts supply only decision input; they cannot override the URL, authorization header or connection identity. Send only to the fixed TypeSafe HTTPS origin and refuse redirects.
- Parse provider responses at the boundary: match all requested question IDs and types, constrain returned choices to supplied options, validate finite numeric values/ranges and bound payload sizes using existing IPC limits. Never silently truncate input or substitute fabricated answers.
- Use bounded requests: proposed defaults are a 30-second attempt timeout, up to three total attempts within a 60-second operation deadline, and a configurable limit of 20 total HTTP evaluation attempts per run. Retries count toward the limit. Honor provider backoff only within that deadline. Cancel immediately with the Pod/run signal. Retry transient network/429/529 failures; surface authentication, validation and exhausted failures explicitly.
- Treat this as model inference, separate from the HTTP delivery effect ledger. A transport retry may incur another provider charge; do not claim exactly-once billing. Ordinary script effects retain the existing effect ledger. An inference failure must not create a stuck “delivery outcome unknown” entry.
- Emit sanitized operation metadata: provider, requested/resolved model, duration, attempts and returned token usage. Retain neither request state nor full answers in central activity by default. The script decides whether a business result belongs in its checkpoint.
- Extend synthetic validation with schema-valid deterministic Jev fixtures. Mark those results synthetic and exercise all routing branches in focused tests. Synthetic success is never evidence of provider quality or live connectivity.

**Acceptance:** a Jev-only script runs without any `agent.run` event; unauthorized requests fail before provider access; revocation cancels an in-flight operation; rate limiting ends within the configured bound; an inference error leaves the generic HTTP delivery ledger clear; malformed answers fail explicitly.

**Rollback:** disable `jev.evaluate` and leave affected Pods paused with a visible explanation. Do not silently substitute Codex.

### M3 · Make the capability discoverable to Codex and people

**Goal:** the owner need not remind Codex about Jev on every Pod creation.

- Extend `runtimeReference` with the installed Jev contract, supported question types, a complete example and a short selection guide: ordinary code for exact calculations and rules; Jev for bounded semantic decisions; `agent.run` for generated text and open-ended work.
- Extend `CodexControl.runtime()` as well as internal master instructions. They have different administration permissions today; preserve that distinction. Update the existing MCP tool/server discovery text so the initial tool listing advertises Jev decisions and directs the agent to read `runtime`.
- Return actual runtime-specific connection availability in catalogue metadata, and actual assignment/model/permissions in selected-Pod inspection. Do not make a static document claim a live connection exists. Refresh inspection before drafting or execution after connection changes.
- For missing setup, Codex creates the useful draft and directs the owner to protected key entry. It may configure the connection reference under existing administration authority; no extra blanket approval queue is introduced. Existing execution grants still apply.
- Expose the Jev helper in the script editor reference/snippets and in the handbook. The official TypeSafe agent skill is useful background, but a global third-party skill installation is not a prerequisite. OpenApe's installed runtime reference is authoritative for its helper and permissions.
- Extend sanitized central workspace projection and any affected `packages/pods-protocol` contracts so browser-created Pods and remote Codex access report the same availability. Remote clients must not acquire native credential access.

**Acceptance:** a fresh connected Codex session receives a neutral request such as “Build a Pod that routes support messages by department.” It discovers Jev from the tool reference, inspects availability, saves a valid script using the helper, and reports missing setup accurately. Repeat disconnected, after reconnect, and with a different selected Pod. Confirm an ordinary calculation still produces plain code and a summary request still uses an appropriate text generator.

**Rollback:** remove Jev discovery/snippets together with the feature flag or capability; do not advertise an unavailable runtime API.

### M4 · Prove quality and release

**Goal:** deliver one useful, measurable workflow, with clear failure and review paths.

- Use a read-only support-message routing example with a small owner-reviewed English/German fixture set. Include ambiguous messages and cases outside the defined categories. Keep questions and thresholds together in one `pod-script.mjs`; version history remains in Pods.
- Before enabling automatic downstream actions, agree the fixture labels and acceptable error/review rate for that workflow. There is no universal confidence threshold. Preserve uncertain cases for review; never silently discard them. Any optional LLM fallback must be explicit in the script and visible in its permissions/costs.
- Compare Jev and the current LLM approach on the same inputs: correct routes, review rate, latency and measured token usage. Prices and quality are evaluation inputs, not product guarantees. Record the exact model version used.
- Exercise account setup and run history in a native UI smoke test; inspect desktop and narrow central-web screenshots. Publish real evidence through ape-testruns. Package/release using the existing Pods distribution workflow; deployment is a separate implementation action after approval.

**Acceptance:** the creation-to-run scenario below passes, existing provider/script flows remain green, and recorded classification quality meets the agreed fixture criteria. If quality misses the target, keep Jev available as an explicit option and document the boundary; do not automatically migrate existing Pods.

**Rollback:** revert the feature via a native PR and restore the previously tested application build using its documented compatible schema path. Pause only Pods requiring Jev; keep their source and evidence.

## Scope boundaries

The first release supports the direct TypeSafe API, one optional local connection, per-Pod assignment, three decision types, native key setup and discovery through existing authoring surfaces. Multiple provider accounts, a general provider marketplace, model training, browser-based key transfer, automatic conversion of existing Pods and replacing the Codex coding engine are deferred.

## Architecture and trust

<p><strong>Authoring:</strong> owner → Codex / internal setup chat → Pods reference + current capabilities → saved script.</p>
<p><strong>Execution:</strong> script → <code>context.jev.evaluate</code> → scoped worker request → native connection service → TypeSafe → validated decision → ordinary script logic.</p>
<div class="callout callout-danger"><p><strong>The API key stays in the encrypted native credential store.</strong> It is not a generic script-readable secret. Only assigned Pods may evaluate, and model output never grants permission. TypeSafe receives the state explicitly supplied by the script; the setup review must describe that data. Logs and central snapshots contain operational metadata, not the key or raw input.</p></div>

### Proposed script contract

The example below illustrates the proposed OpenApe helper, not an API already installed. Assignment selects the connection and a pinned model. The `0.8` threshold is an illustrative review rule, to be replaced by the workflow's measured threshold.

```js
const questions = {
  department: {
    type: 'choice',
    instructions: 'Which department should handle this message?',
    criteria: {
      billing: 'Invoices, payments and refunds',
      technical: 'Bugs and technical problems',
      review: 'Unclear, unrelated or insufficient information',
    },
  },
}

export async function run(context) {
  const result = await context.jev.evaluate({
    state: context.variables.sampleMessage,
    questions,
  })
  const answer = result.answers.department
  const route = answer.confidence < 0.8 ? 'review' : answer.choice
  context.log(`Suggested route: ${route}`)
  return {
    status: 'completed',
    summary: `Suggested route: ${route}`,
    completedInputIds: context.input.eventIds,
    gapIds: [],
  }
}
```

### Verified TypeSafe contract

As checked on September 25, 2026, the direct API uses Bearer authentication, `GET /v1/models` for discovery and `POST /v1/systemone` for evaluation. Requests contain `state`, `questions` and a model. Results contain answers keyed by question ID, the resolved model and token usage. Choice selects among supplied options; Score evaluates ordered criteria; Noul returns a number between zero and one. Choice and Score include probabilities and confidence. Noul has no confidence field. Sources: [API](https://docs.typesafe.ai/api), [confidence](https://docs.typesafe.ai/confidence).

The published stable version is `jev-1.13.0`; aliases can move. Pin the version verified in M0 for enabled Pods. Model discovery currently lists aliases, so absence of a versioned ID from that list must not alone reject it. English is the primary training language; German quality needs local evaluation. Recheck these facts before implementation. Sources: [models](https://docs.typesafe.ai/models), [known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [coding-agent boundary](https://docs.typesafe.ai/introduction/coding-agents), [official agent skill](https://docs.typesafe.ai/agent-skill).

## Repository orientation

Canonical repository: `https://repos.openape.ai/patrick/monorepo`. Planning inspected `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/pods-central-stability`, branch `bugfix/issue-1384-pods-central-stability`, clean HEAD `0003ecb4bd7d5cb225bc2fac8cf25dcc2e750c31`, identical to freshly fetched `origin/main`. This was a borrowed read-only checkout and remains unchanged. Dedicated worktree, created at the owner's request: `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo.worktrees/jev-integration`, branch `feature/issue-1385-jev-integration`, base `0003ecb4bd7d5cb225bc2fac8cf25dcc2e750c31`. Native delivery issue: [#1385](https://repos.openape.ai/patrick/monorepo/issues/1385). The local plan is `.claude/plans/jev-integration.md` within that worktree.

Stack: Electron, Vue, TypeScript, local SQLite, encrypted native credentials and a sandboxed Node script runner. Node 24.15.0 and pnpm 10.29.3 were verified with `pnpm run doctor`: `ok: true`; only the existing branch's absent upstream produced a warning. The doctor is environment evidence, not a feature test.

All paths below are relative to `apps/openape-pods/` unless prefixed otherwise.

| Boundary | Existing entry points |
| --- | --- |
| Account setup | `src/renderer/Onboarding.vue`; `src/contracts/onboarding.ts`; `src/main/connections/manager.ts`; `src/main/connections/cache.ts` |
| Script interface | `src/worker/runs/script-entry.ts`; `src/worker/runs/dispatcher.ts`; `src/contracts/services.ts`; `src/contracts/credentials.ts` |
| Assignment and authority | `src/contracts/resources.ts`; `src/worker/resources/registry.ts`; `src/main/programs/http-service.ts`; `src/main/broker/authorization.ts` |
| Validation and persistence | `src/worker/master/validation.ts`; `src/worker/storage/database.ts` |
| Authoring and MCP | `src/worker/master/reference.ts`; `src/worker/master/instructions.ts`; `src/worker/codex/control.ts`; `src/runtime/codex-mcp.ts`; `src/contracts/codex.ts` |
| User-visible output | `src/renderer/PodScript.vue`; `src/renderer/PodResources.vue`; `src/renderer/run-activity.ts`; `scripts/handbook-content.mjs` |
| Central projection | `src/worker/central/projection.ts`; repository-root `packages/pods-protocol/` |

The worker-to-main bridge must be followed from current call sites during M0; do not add an independent unscoped networking path. Existing HTTP permission/identity checks are the authorization reference, not a license to broaden HTTP permissions.

## Verification strategy

Extend the established suites, without a new runner or a change to automatic CI routing: `test/onboarding/auth.test.ts`, `test/credentials/cache.test.ts`, `test/codex/control.test.ts`, `test/main/codex-server.test.ts`, and existing workspace/program suites. Small focused Jev contract/service tests may be added within `test/`. Retain tests for cross-Pod access, secret isolation, cancellation/revocation, provider response validation and discovery because these are durable feature contracts with meaningful failure consequences. Keep one focused creation-to-run smoke in the existing harness; E2E/layout remain manually invoked.

From the new implementation checkout, prepare the installed toolchain in every shell:

```sh
export OPENAPE_PNPM_BIN=/Users/patrickhofmann/Companies/private/repos/openape/.toolchains/pnpm/10.29.3/bin
export PATH="$OPENAPE_PNPM_BIN:$PATH"
. ./scripts/activate-node.sh
pnpm run doctor
pnpm check:affected --base origin/main --head HEAD --dry-run
```

Install pinned dependencies if needed with `pnpm install --frozen-lockfile`; build any consumed workspaces serially as reported by the affected-check tooling. Required implementation gates, stopping at the first failure:

```sh
pnpm lint
pnpm typecheck
pnpm --filter @openape/pods build
pnpm --filter @openape/pods test:fast
```

Use `pnpm --filter @openape/pods dev` for the native smoke on an unlocked Mac. Run targeted existing Electron tests only when the boundary requires them. Run affected tests for central-web/protocol consumers if changed. External CI for the exact pushed head uses the existing unit contract; no automatic E2E/layout jobs are added. Run `pnpm check:ci` before any eventual deployment under repository policy.

### End-to-end acceptance sequence

1. Connect TypeSafe with protected input, observe verified status, restart and confirm persistence.
2. In a fresh Codex session, request a support-routing Pod without naming Jev. Inspect the saved script and actual assignment; verify runtime discovery supplied the capability.
3. Validate synthetically, then explicitly run once with labelled synthetic text. Observe a Jev operation and no LLM-agent event. Verify no raw key/input in MCP output, logs, database projections or browser network responses.
4. Repeat with Codex disconnected from runtime inference. The Jev script still runs; a script requesting `agent.run` reports its missing provider.
5. Exercise uncertain answers, invalid key, rate limit, timeout, malformed response and disconnect during a run. Observe bounded failures or the script's explicit review branch, no fake success and no stuck HTTP delivery receipt.
6. Inspect desktop and central-web status, run metadata and read-only remote setup guidance. Confirm an unassigned Pod cannot use the connection.
7. Run the labelled German/English evaluation and record actual quality, usage and model version. Enable a schedule only as part of an explicitly authorized rollout.

## Risks and open evidence

| Risk | Resolution |
| --- | --- |
| Hidden global Codex gate | M0 proves Jev-only execution and narrows only unnecessary account checks. |
| Wrong or overconfident decisions | Labelled fixtures, explicit uncertain outcome and workflow-specific thresholds. |
| Changed model/API behavior | Pin verified model, parse the external boundary, record actual version. |
| Sensitive input sent upstream | Review the actual script state; minimize fields; no automatic mailbox sample upload. |
| Retry cost or stalled execution | Bound attempts/deadline; count retries; use dedicated inference semantics. |
| Local and central UI drift | Project only sanitized availability from the owning runtime; show offline distinctly. |

Planning did not use a live key. The owner subsequently authorized use of the existing test-project key; current implementation evidence is recorded under Progress. Workload quality and production rollout remain separate acceptance steps.

## Progress

- 2026-09-25: owner approved implementation and requested the key from the existing Jev test project. The dedicated worktree is `feature/issue-1385-jev-integration`; implementation was integrated with canonical main `63ab0bf0788e02dfd5c6fd8f5f7936977cfbbe6f`, including the new format-2 central publication path.
- M0: authenticated model discovery and a synthetic German support message passed against the real TypeSafe API. `jev-1.13.0` returned valid Choice, Score and Noul answers in one attempt (1,049 ms, 398 input tokens, 69 output tokens). The native script bridge also passes a Jev-only execution test. No live mailbox data was used.
- M1: encrypted native API-key setup, replacement, disconnect and per-Pod grants implemented. The owner-authorized existing key is saved and verified in the isolated development profile `/Users/patrickhofmann/.config/openape/jev-development`; the account view shows a ready connection after restart. The installed production profile has not been modified.
- M2: scoped `context.jev.evaluate` implemented, with pinned models, response validation, bounded retries, per-run budgets, grant monitoring and revocation. Durable tests cover cross-Pod access, missing capability, failed replacement, secret isolation, disconnect, malformed provider replies, budget exhaustion and inference failure without HTTP delivery receipts. No new dependencies or test runners were added.
- M3: installed MCP reference, internal authoring instructions, Pod inspection, native accounts/permissions, central projection, script reference, run metadata and bilingual handbook updated. Full and format-2 central projections retain only availability metadata. Native account UI and narrow central screenshots were inspected.
- Verification on the integrated tree: full `pnpm lint` (54 tasks), `pnpm typecheck --concurrency=1` (77 tasks), `pnpm --filter @openape/pods build`, `pnpm --filter @openape/pods test:fast` (492 unit/component tests and 22 browser tests), and `pnpm --filter @openape/pods exec vitest run --config vitest.electron.config.ts e2e/script-runner.test.ts` (11 native script tests) pass.
- Delivery: [native PR #134](https://repos.openape.ai/patrick/monorepo/pulls/134), implementation commit `fa31c9bc684ed02b6c23a5f2d762eba62daf961a`, target `63ab0bf0788e02dfd5c6fd8f5f7936977cfbbe6f`. The native PR diff is mergeable and was reviewed. [Published evidence](https://testrun.openape.ai/r/q8kG0M6twEJoIpqcVVx8reEg) includes four inspected screenshots. Commit and push hooks passed the affected unit contract, including the relay consumer. External exact-head CI is pending.
- Remaining release acceptance: a fresh neutral Codex authoring session followed by an owner-authorized live Pod run, owner-reviewed workflow labels/thresholds and the comparative LLM benchmark. Synthetic fixtures and the API smoke check do not establish production classification quality. No schedules were enabled, no existing Pods were migrated, and no signed production update was installed.

## Surprises and discoveries

- Jev is a decision model rather than a coding model. The user outcome is scripts that call Jev, authored by Codex or another coding agent.
- The current `executeHttpEffect` marks failed mutating HTTP requests as unknown delivery. Reusing that path for TypeSafe's POST inference would risk blocking a Pod after a temporary model error. Evidence: `src/worker/runs/http.ts` and the unknown-effect checks in `src/worker/runs/dispatcher.ts` at the inspected SHA.
- External connected Codex has broader administration authority than the internal setup chat. Evidence: `src/worker/codex/control.ts` derives and adjusts the master reference. Discovery must cover both without copying stale approval instructions between them.

## Decision log

| Date | Proposed decision and reason |
| --- | --- |
| 2026-09-25 | Native API-key connection, separate from Codex account: matches TypeSafe authentication and the existing setup experience. |
| 2026-09-25 | Built-in `context.jev.evaluate` helper: keeps keys and permission checks in the runtime and avoids an SDK installation in every Pod. |
| 2026-09-25 | Dedicated inference operation: preserves ordinary HTTP effect guarantees while handling model retries correctly. |
| 2026-09-25 | Discover through existing MCP/reference surfaces: no new chat product or globally installed skill required. |
| 2026-09-25 | Explicit per-Pod opt-in and pinned model: existing automations retain their behavior. |

## Session checklist and outcome

Each implementation session reads this plan, current AGENTS.md and mapped project memory; checks current Git state and changes since the previous session; runs the relevant baseline; advances one milestone; records real evidence and remaining blockers; and updates both the local plan and Plans review copy. Plans owns this proposal; a future native issue owns delivery and links here without duplicating its lifecycle.

Implementation outcome: optional TypeSafe connection and structured Jev decisions are available in the development build, with automated boundary coverage and a successful direct live evaluation. PR review and the remaining release acceptance precede any production rollout.
