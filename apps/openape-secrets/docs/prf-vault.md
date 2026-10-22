# PRF vault and direct agent delivery

Issue: https://repos.openape.ai/patrick/monorepo/issues/1533

Approved scope: the Secrets service owns its release decisions. DDISA identifies
principals through the existing SP session/token exchange; the grant system and
protocol are unchanged. There is no proxy, credential-injecting gateway or MITM.

## Milestones and acceptance

- M0: canonical source/auth boundary inspected; interactive `/prf-check` diagnostic
  added. Physical passkey/browser compatibility remains an explicit manual gate.
- M1: browser/Node WebCrypto format, per-passkey wrapping with a local wrap/unwrap self-check, separate offline recovery
  proof, additional-passkey enrollment and encrypted immutable versions implemented.
- M2: `/vault` supports setup, encrypted storage/replacement, consumer binding,
  request approval/denial, release revocation and recovery. Dedicated workers hold
  vault keys for one ceremony and terminate at completion, page hide or five minutes.
- M3: strict human session plus fresh UV assertion for expansion; frozen descriptors;
  session-bound, consumed challenges; transactional once/timed/standing collection.
- M4: `ape-secrets vault request|status|deliver`; direct new-file/process delivery.
- M5: unit, component, real-signature WebAuthn and database contention tests; deployment
  remains disabled until the repository gate, physical PRF and authenticated browser
  acceptance have passed. Software authenticator tests do not prove hardware PRF.

## Identity and key boundaries

Human management requires a verified DDISA `human` browser session, with actor equal
to subject. A bearer token, including a human bearer token, cannot create a vault or
approve a release. Every cookie-authenticated mutation requires the configured
Origin. API results use `no-store`. The existing `secrets:request` catalog now lists
v2 request/status/collect routes, without creating new grants or changing their
meaning as an authentication/scope ceiling. Application release policy is additional.

Each legacy consumer is explicitly bound, with a human passkey, to one verified
collector identity and a public-key fingerprint. That identity must already be the
owner or an allowed requester on the legacy registration. Both are checked again
at commit. Changing or disabling the v2 binding invalidates existing releases.
Legacy v1 consumer/request APIs never read `sv_*` tables. There is no automatic
migration of v1 envelopes; humans enter secrets again through the vault UI.

The vault uses its own RP ID (`secrets.openape.ai` in production). An IdP login
passkey registered for another RP is not silently reused. The user may choose the
same provider, but enrolls a separate vault credential. `userVerification=required`
is verified server-side; an authenticator may satisfy this with biometric or PIN.
It does not promise specifically Touch ID or forbid an OS verification grace period.

- A random 256-bit vault master key (VMK) wraps per-secret-version random DEKs.
- PRF output never becomes the VMK. HKDF-SHA-256, a random salt and a domain/binding
  derive an AES-256-GCM key wrapping the VMK for each passkey.
- PRF input is stable per credential and public. WebAuthn challenges are fresh,
  random, five-minute, browser-session-bound and transactionally consumed.
- AES-GCM additional authenticated data binds values/DEKs to owner, secret ID and
  immutable version; wrappers bind credential/owner or recovery ID/purpose.
- A 256-bit offline recovery code independently wraps the VMK and a P-256 signing
  private key. Recovery signs a session challenge; only the recovery public key,
  ciphertext and signature reach the server. DDISA login remains required.
- Adding a passkey requires an existing passkey ceremony or the recovery proof.
  Disabling that authorizing credential invalidates unfinished enrollment ceremonies.
- Lost passkey: enroll a replacement and disable the lost credential. Lost recovery
  code is not a login reset. Losing every PRF-capable credential AND the recovery
  code loses the data. Back up ciphertext and a usable recovery code separately.

The browser serializes WebAuthn responses via an allowlist. Extension results are
never sent; the server rejects nonempty extension results. PRF buffers are transferred
into a dedicated worker and cleared. VMK/DEKs stay in that worker. No keys are kept in
local/session storage, IndexedDB, service workers or logs. JavaScript zeroization is
best effort; runtime/OS copies cannot be guaranteed erased. The deployment must keep
the human browser context separate from an agent with debugger/OS access. A malicious
same-origin script, compromised client or fully privileged local agent remains outside
this boundary. Server-delivered JavaScript remains part of the trust model.

## Release semantics

An approval is bound to owner, verified requester, consumer ID, SHA-256 public-key
fingerprint, secret ID, exact version, approval ID, mode and deadline. The browser
opens only the selected value and seals it to the consumer P-256 key using ephemeral
ECDH, HKDF-SHA-256 and AES-256-GCM. The entire canonical descriptor is authenticated.
No PRF, VMK or DEK is delivered. The service sees metadata and ciphertext only.

- `once`: one successful database consumption, collect within 24 hours. Consumption
  clears the stored envelope before the response is returned. Concurrent calls cannot
  both receive it. A crash or lost response after commit requires new approval; it is
  at-most-once retrieval, not exactly-once use or a guarantee the target action ran.
- `timed`: repeat retrieval until the frozen deadline (60 seconds–7 days).
- `standing`: repeat retrieval until revoked, recipient rebind/disable or version
  replacement/deletion. No open browser is needed after initial approval.

Revocation/expiry control future retrieval, not copies already received. The agent
can read or retain a delivered value and its private consumer key. Secrets aliases,
identities, request reasons, timestamps and release metadata are visible to the
service; encrypted values are not. Requests expire after a day. Agent-provided
reasons render as text, never HTML/instructions executed by the application.

Unknown aliases support ad-hoc direct input; they are not silently stored as vault
secrets. A user can create a stored alias separately. A new stored version always
requires a new release. Pending requests for older versions cannot be approved.

## Storage and compatibility

Additive `sv_vaults`, `sv_credentials`, `sv_secrets`, `sv_versions`, `sv_consumers`,
`sv_requests`, `sv_approvals`, `sv_challenges`, `sv_audit` tables have indexed owner/ID
columns and JSON records, owner foreign keys, payload identity checks and an active-alias unique index. Existing v1 tables/data are untouched. The database
transaction is the correctness boundary; an in-process queue only avoids local
connection contention. Failed initialization fails closed.

This first single-owner implementation scans records within an indexed owner.
It is not a high-volume multi-tenant query model. Pending requests and challenge
creation are bounded; deployment ingress must limit request bodies to 100 KB and
rate-limit the API. The handler also rejects oversized declared/parsed bodies.
Ciphertext versions and audit records are retained. Delete marks the current secret
unavailable and revokes releases; encrypted history/backups are not physically purged.
The UI does not offer old-version restore yet. Establish retention/backup policy
before broad rollout; never collect HTTP bodies or browser state in telemetry.

## Direct CLI usage

Use existing `apes login` and `ape-secrets keygen --allow AGENT_IDENTITY` on the
receiving machine. In `/vault`, bind that consumer to the exact collector identity
using a passkey. The requester and collector must be that identity.

```sh
ape-secrets vault request --consumer CONSUMER_ID --alias API_TOKEN --purpose 'Configure the target service'
ape-secrets vault status REQUEST_ID
ape-secrets vault deliver REQUEST_ID --out /private/path/new-token
ape-secrets vault deliver REQUEST_ID --exec '["target-cli","set-token","--stdin"]'
ape-secrets vault deliver REQUEST_ID --exec '["target-command"]' --env API_TOKEN
```

`deliver` has no plaintext stdout mode. It emits only receipt metadata; target stdout
and stderr are discarded, including errors. `--exec` is a JSON argv array, never a
shell command. Without `--env`, exact bytes go to stdin with no appended newline.
`--out` uses exclusive creation and mode 0600, refuses existing paths/symlinks and
removes an incomplete output. The local key and sink are checked before consuming a
once release. Failure after consumption cannot be retried with that release. An
explicit output file persists; the caller owns its later cleanup. A receiving process
can still write its own files or transmit the value. No system can retract that use.
The existing v1 `fetch` CLI behavior is unchanged and can still print plaintext;
agent integrations should use the v2 `deliver` commands.

## Rollout and rollback

1. Run the required affected unit gate and build the app/CLI from canonical source.
   Before any deployment run `pnpm check:ci`, per repository policy.
2. Back up the existing database. Deploy the tested image with
   `NUXT_SECRETS_VAULT_ENABLED=false` (default). Confirm existing v1 behavior.
3. Set `NUXT_SECRETS_VAULT_ORIGIN=https://secrets.openape.ai` and a non-development
   session secret. Keep HTTPS and existing DDISA client registration. Configure ingress
   body/rate limits and exclude v2 bodies from logs/traces. Avoid third-party scripts.
4. Run `/prf-check` with the actual browser, device and passkey provider. Record origin,
   browser/OS/provider, repeated PRF stability, UV, cancellation and additional-device
   behavior. Do not record actual PRF output. Remove the diagnostic credential manually.
5. Enable v2 for the pilot; verify real authenticated setup, recovery acknowledgement,
   store/reopen after browser restart, additional passkey, recovery, and CLI delivery of
   a disposable secret. Verify once replay, timeout, revoke and version/key rotation.
6. Promote only with the above evidence. Rollback is setting the flag false or restoring
   the previous tested image. Preserve `sv_*` tables and backups for recovery; never
   roll back by deleting keys or ciphertext. V1 remains available independently.

Local diagnostic: activate the repository toolchain, then run
`NUXT_SECRETS_VAULT_ENABLED=true NUXT_SECRETS_VAULT_ORIGIN=http://localhost:3025 pnpm --filter @openape-secrets/app dev`.
Only development permits HTTP localhost. `/prf-check` needs no login because it keeps
all test state in the browser. `/vault` still requires real DDISA authentication.
