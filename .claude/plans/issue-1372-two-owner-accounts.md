# Plan: Pods — exactly two owner accounts (Codex and DDISA)

Issue: https://repos.openape.ai/patrick/monorepo/issues/1372 (supersedes 1365).
Worktree `../wt-issue-1372`, branch `feature/issue-1372-two-owner-accounts`, base `origin/main` `b15b564a`.
Status: **approved 2026-09-22 (D1 re-provision, D2 one-time consent, D3 email + DNS); implemented, PR pending.**

> **As implemented (supersedes the draft sections below where they differ):** no `pod_identities` table and no schema 23 — Pod bindings stay in the single owner row; reconciliation runs idempotently at startup (`src/worker/onboarding/reconcile.ts`). Bindings of other identities are released (D1: re-provisioned under the owner on first use), not kept as hidden legacy rows. The DDISA card always has one email field (Sign in / Sign in again / Switch account); the IdP comes from the DDISA DNS record. Switching with bound Pods requires confirmation. See Decision Log.

## Purpose / Big Picture

- **Goal:** "Your accounts" shows exactly one Codex row and one DDISA owner row, each with sign in / sign in again / disconnect. There is no expected-account field, no identity-provider field, no default-owner picker and no Telegram/Microsoft/provider text. Pod creation, grants and mobile access use the single owner implicitly. New Pod agents are created on the Pods provider (`pods.openape.ai`) and never touch the owner's account row.
- **Context:** On September 22 Patrick's profile listed two `phofmann@delta-mind.at` rows (one failed with "Owner identity does not match the requested account"), one `patrick@hofmann.eco` row and no default owner, so mobile access refused ("Connect and select your OpenApe owner account on desktop first").
- **Scope:** Desktop app `apps/openape-pods` only: connection model, schema migration/reconciliation, "Your accounts" page, sidebar account status, Pod identity wording, mobile owner lookup, i18n, both handbooks. Out of scope: IdP/Pods-provider servers, the iOS app, Microsoft application accounts in Pod permissions (they stay per Pod), re-provisioning or moving existing agents.

## Why several DDISA rows appear today (diagnosis from code)

1. **Every "Start sign-in" creates a new row.** `ConnectionManager.execute({type:'connect'})` (`src/main/connections/manager.ts`) always uses `randomUUID()`; nothing looks for an existing row with the same issuer/subject or email. Signing in twice with the same account yields two rows.
2. **Failed attempts stay forever.** `startLogin` saves the row before the browser flow and marks it `failed` on error. The page offers "Sign in again" for failed rows but no removal; "Disconnect" is only shown for `ready`/`expired`.
3. **The mismatch error comes from the "Expected account" field.** `ownerClaims` (`owner.ts`) requires the signed `email` claim to equal the typed expected account. If the browser's IdP session belongs to another address (e.g. `patrick@hofmann.eco` while `phofmann@delta-mind.at` was typed), the token is rejected and a failed row remains.
4. **Multiple owners are a first-class concept.** Pod bindings live in each owner row's `metadata.pods`; `onboarding.default_owner` (schema 19) selects the owner for new Pods and for mobile access (`remoteOwner`). Without a default, new Pods and mobile access refuse.
5. **Pod creation writes into the owner row.** `preparePodConnection` stores each Pod's agent binding (`connectionId`, keys reference, subject, broker) inside the owner row's metadata, so every new Pod changes the owner's connection row. Without an account-wide provider consent the agent is provisioned at the owner's own IdP (`POST /api/pods/agents` at `id.openape.ai`), i.e. next to the owner's human identity.
6. **Agent identities are never stored as connection rows** in the current code; the page shows only `chatgpt`/`openape` rows. What reads like "agent identities as owner accounts" is the wording around them: Pod settings list "Agent identity" and "Permission decisions" side by side, the page text points to per-Pod identities, and agents created at `id.openape.ai` sit under the owner's IdP account. The installed profile was not inspected (only fixture profiles are used); if the observed extra row had an agent address as `account`, reconciliation below still removes it from the page because it has no human `(issuer, subject)` of the owner.

## Target model

- `connections` keeps at most **one** `chatgpt` row and at most **one** active `openape` owner row (the *owner*). Microsoft rows are unchanged (per-Pod application accounts, not shown on the page).
- Pod agent bindings move out of the owner row into a new table `pod_identities(pod_id PRIMARY KEY, owner_connection TEXT NOT NULL REFERENCES connections(id), entry TEXT NOT NULL)`. The owner row then holds only sign-in metadata (`issuer`, `subject`, broker consent). Creating/deleting Pods touches only `pod_identities` and per-Pod credential files.
- `onboarding.default_owner` becomes the owner pointer written only by sign-in/reconciliation (column retained; no picker, no `setDefaultOwner` command).
- DDISA sign-in: fixed issuer `https://id.openape.ai`, no login hint on first sign-in; the account email and subject are taken from the verified token (`act: human`, signature, issuer, audience, nonce still checked). When an owner already exists, "Sign in again" sends that email as login hint and **requires the same `(issuer, subject)`**; a different identity is refused with "This is a different DDISA account; Pods belongs to X". Replacing the owner with a different identity is allowed only when no Pod is bound to the old one (the old row is then removed).
- Provider consent for `pods.openape.ai` is requested once, automatically, as part of the first Pod identity provisioning (see decision D2). New Pods always provision via the broker; existing Pods keep their current provider, key and grants.

## Reconciliation of existing profiles (schema 23, one transaction, `VACUUM INTO` backup as for every migration)

Input: all `openape` rows, `default_owner`, every row's `metadata.pods`.

1. **Identity key** per row: `(metadata.issuer, metadata.subject)`; rows without a verified subject (never completed sign-in) have no identity.
2. **Owner identity:** the identity of `default_owner` if set and verified; else the single identity holding Pod bindings; else the most recently ready identity (latest rowid); else none (page shows "Sign in").
3. **Canonical owner row** within the owner identity: the `default_owner` row, else the ready row with bindings, else the latest ready row.
4. **Move bindings:** every `metadata.pods[podId]` entry is copied verbatim into `pod_identities` with `owner_connection` = its current row id (not rewritten), then removed from the row metadata. Agent credential files are keyed by `entry.connectionId` and are not touched → no re-provisioning, keys/grants survive.
5. **Duplicates of the owner identity:** their bindings are re-pointed to the canonical row (same `(issuer, subject)`, so agent owner claims still match); resource/grant configurations that reference the duplicate id (`ownerConnection`, `authority.ownerConnection`, `grants[].authority.ownerConnection`) are rewritten to the canonical id; the duplicate rows are deleted; their owner-token cache is erased after commit (the canonical row keeps its own tokens).
6. **Rows without identity and without bindings** (failed/connecting/revoked attempts) are deleted with their token cache.
7. **Other identities with bindings** (e.g. Pods bound to `phofmann@delta-mind.at` while the owner is `patrick@hofmann.eco`) cannot be merged without re-provisioning (the agent's owner claim is fixed at the IdP). They stay as **hidden legacy owner rows**: not on "Your accounts", still used for their Pods' grants while their token is valid; the Pod's settings show a diagnostic with "Sign in again" for exactly that account. See decision D1.
8. **Other identities without bindings** are deleted with their token cache.
9. Conflict (the same Pod bound in two rows): migration aborts with the existing error and the backup; the profile stays on schema 22 (same behaviour as today's runtime check).

## Milestones

### M1 — Storage and reconciliation (worker)

1. `src/worker/storage/database.ts`: schema 23 = `pod_identities` table + `reconcileOwners(db)` in a new `src/worker/onboarding/reconcile.ts` (pure SQL/JSON, no network).
2. `src/worker/onboarding/store.ts`: `owner()`, `podIdentity(podId)`, `bindPod`, `unbindPod`; remove `setDefaultOwner`; `save` refuses a second active `openape` or `chatgpt` row.
3. `src/worker/onboarding/control.ts`: new internal commands `podIdentity`/`bindPod`/`unbindPod`; drop `setDefaultOwner`.
4. Test `test/onboarding/reconcile.test.ts` with a fixture profile of the September 22 shape: two `phofmann` rows (one failed without subject), one `patrick` row with bindings + default, an attempt row, resources/grants referencing a duplicate id, agent credential files. Asserts: one owner row, bindings/grant references/agent credential files intact, no provisioning call, legacy row hidden, idempotent second run.

**Proof:** `pnpm --filter @openape/pods test -- test/onboarding` green.

### M2 — Connection manager and sign-in

1. `manager.ts`: `connect` reuses the existing provider row (never a new UUID when one exists); `podConnection`/`podIdentity`/`existingRemotePods`/`purgePodKeys`/`remoteOwner` read `pod_identities` and the owner pointer; remove `setDefaultOwner`, `makeDefault`, expected account and issuer from the command contract (`src/contracts/onboarding.ts`, view drops `defaultOwner`, gains `owner`).
2. `owner.ts`: `ownerClaims` accepts the token's email when no expected account is set and enforces same subject on re-sign-in.
3. New Pods: implicit broker path (D2); provisioning never saves the owner row.
4. `remoteOwner` uses the owner; message becomes "Sign in with your DDISA account on desktop first".
5. Extend `test/onboarding/manager.test.ts` (replace default-owner cases): reconnect with another identity refused; new Pod leaves the owner row byte-identical; mobile owner without selection.

### M3 — UI, i18n, handbooks

1. `Onboarding.vue`: two fixed cards (Codex / GPT, DDISA) with state, account email, sign-in code/link, cancel, sign in again, disconnect with confirmation; one intro sentence. No form fields.
2. `AccountStatus.vue`: shows the owner; "Sign in" instead of "Choose your account".
3. `PodIdentity.vue`: "Pod agent" instead of "Agent identity", no default-account text; provider details only inside "Identity details" for diagnosis; legacy owner diagnostic with its own sign-in again.
4. `src/i18n/de.json` + remove unused keys; `docs/handbook.md`/`handbook.de.md`/json sections "Connect your personal accounts", troubleshooting and provider consent; refresh handbook screenshots via existing `e2e/handbook.test.ts` (`pnpm --filter @openape/pods handbook --refresh-images`).
5. Component tests in `test/onboarding/ui.test.ts`: not signed in / signed in / needs re-authentication for each of the two accounts, no "Expected account" or picker rendered, disconnect confirmation emits the right command.

### M4 — Verification and PR

- During development: `pnpm check:affected --base origin/main --head HEAD`; before commit full `pnpm lint` + `pnpm typecheck`; `pnpm turbo run build --filter=@openape/pods`.
- Visual check: packaged fixture screenshot of "Your accounts" in both states, inspected and sent.
- Push once; the external full contract runs on that head. Check the mirror layout task queue (`https://git.openape.ai/api/v1/repos/openape-ai/openape/actions/tasks`) before any xcodebuild/commit/push gate.
- Native PR linked to issue 1372 (full URL + explicit relation); `docs/agents/active-work.md` entry.

**Rollback:** code rollback keeps `pod_identities` (additive) but an older app would not read it → restore the schema-22 `VACUUM INTO` backup created by the migration. Installation on Patrick's Mac is a separate decision after merge.

## Decisions needed (Patrick)

- **D1 — Pods bound to a second human identity:** keep them working as hidden legacy bindings (recommended, no re-provisioning) vs. re-provision them under the owner (loses their agent identity and grants) vs. block the upgrade until resolved.
- **D2 — Provider consent:** Grant Brokering 1.0 §3 requires that the UI explains the permission and shows broker issuer and agent domain before consent. Recommended: a one-time confirmation inside the first "create Pod identity" review (not on "Your accounts"), text fixed to `pods.openape.ai`. A fully silent consent would be an intended deviation from the spec and needs your explicit confirmation.
- **D3 — Identity provider:** fixed `https://id.openape.ai` (recommended; the Advanced field disappears) vs. keeping a hidden developer override via environment variable only.

## Progress

- [x] `2026-09-22 19:10` Read-only mapping and diagnosis; plan drafted.
- [x] `2026-09-22 19:15` Approval: D1 re-provision under the owner, D2 one-time consent at first Pod, D3 always one email field (sign in / switch account), IdP from DNS.
- [x] `2026-09-22 20:00` M1 reconciliation (`src/worker/onboarding/reconcile.ts`, startup via `ConnectionManager.initialize`).
- [x] `2026-09-22 20:00` M2 single-owner manager, DNS discovery, switch confirmation, provider consent required for new agents.
- [x] `2026-09-22 20:20` M3 UI, i18n, handbooks, docs guide, README.
- [ ] M4 PR and external contract.

## Surprises & Discoveries

- 2026-09-22: Grant Brokering 1.0 §3 mandates visible consent text with broker issuer and domain; "owner never needs to know where agents live" can only apply after that one-time consent.
- 2026-09-22: `CredentialCache.path()` calls `safeStorage`; in the unsigned fixture app this opens a Keychain prompt that blocks the Electron main thread (main-process `evaluate` timed out). Account-cache erasure therefore only removes the file without decrypting.
- 2026-09-22: No code path stores agent identities as `connections` rows; extra rows come from repeated/failed sign-ins and multiple human identities.

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-09-22 | Keep Pod bindings in the owner row metadata (no `pod_identities` table) | With D1 there is only one owner row; account, state and identity never change on Pod creation, only the binding map. Smaller, no schema migration | Separate table (larger diff, migration and rollback cost) |
| 2026-09-22 | Reconcile at startup instead of a schema migration | Credential files are erased in the main process; idempotent on every start | Schema 23 migration (worker cannot erase credentials) |
| 2026-09-22 | IdP via DDISA DNS record of the email domain (Patrick) | One email field, IdP always unambiguous | Fixed id.openape.ai |
| 2026-09-22 | New agents require the Pods provider consent; fixture test mode may provision directly | Grant Brokering 1.0 §3; native acceptance fixture has no provider | Silent consent (spec deviation) |

## Outcomes & Retrospective

(after completion)
