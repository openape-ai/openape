# @openape/nest

Local control-plane daemon. Manages OpenApe agents on a single machine — provisions macOS users, hands the bridge lifecycle off to launchd, exposes a localhost HTTP API gated by DDISA grant tokens.

## What it does

- Runs as a long-lived launchd-managed daemon under your user account (`~/Library/LaunchAgents/ai.openape.nest.plist`)
- Accepts API calls on `127.0.0.1:9091` for agent lifecycle ops (`spawn`, `destroy`, `list`, `status`)
- Every API call requires a DDISA-signed grant token in the `Authorization: Bearer …` header
- Bridge processes (`openape-chat-bridge` per agent) are NOT supervised in-daemon — they run as system-domain LaunchDaemons (one plist per agent in `/Library/LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist`) installed by `apes agents spawn --bridge`. launchd is the right OS-level supervisor on macOS; trying to duplicate that in the daemon crashloops without adding value.

## Setup (one-time)

```bash
apes nest install      # install + load the launchd plist
apes nest enroll       # daemon gets its own DDISA agent identity
apes nest authorize    # set the YOLO policy — covers the inner
                       # `apes agents spawn` calls the daemon makes
```

### Optional: privilege isolation with a dedicated service user

By default, `apes nest install` configures the daemon as a user-domain
`LaunchAgent` running under your own Mac user account, with state at
`~/.openape/nest`. That works fine for personal use. For a more
hardened setup the daemon can be promoted to a system-domain
`LaunchDaemon` running under a dedicated `_openape_nest` macOS service
user (uid 481, hidden, no shell, no GUI session) with state under
`/var/openape/nest`.

To migrate an existing user-domain install:

```bash
apes run --as root --wait -- bash apps/openape-nest/scripts/migrate-to-service-user.sh
```

The script creates the user/group, copies your data dir to
`/var/openape/nest`, and swaps the plist. The Nest's IdP identity is
bound to its ssh keypair (which moves with the data dir), so the same
`nest-…@id.openape.ai` identity continues to work — no re-enroll
needed, all existing approved delegations / grants stay valid.

After migration you may want a fresh `apes login --key` for the Nest
to refresh the access token (the migrated `auth.json` carries the
old token; `cli-auth`'s challenge-response refresh handles it on
expiry, but a manual login also works).

After that, day-to-day lifecycle goes through `apes nest`:

```bash
apes nest spawn igor18           # provision a new agent
apes nest list                   # show agents this nest knows about
apes nest status                 # health-check
apes nest destroy igor18         # tear down
apes nest uninstall              # remove the launchd plist
```

## Why every API call needs a grant token

Without auth the API is gated only by "process running as the logged-in human can reach localhost:9091" — a compromised local process inherits everything. The grant-token requirement closes that gap and gives every call an audit record at the IdP. The flow:

1. `apes nest <op>` looks for an existing approved `'always'`/`'timed'` grant matching the operation.
2. If none, requests a fresh grant from the IdP. **First-time** grants for human callers wait for human approval (one approval covers the lifetime of the grant — `'always'` is the default for nest-CLI calls).
3. Token (RFC-7519 JWT signed by the IdP) is fetched and presented as `Authorization: Bearer …`.
4. The Nest verifies signature against the IdP's JWKS, checks `aud=nest`, `iss=<IdP URL>`, `target_host=<local hostname>`, and exact-matches the embedded `command` claim against the route. Fails: `401` (auth) or `403` (command mismatch).

### Grant-scope conventions

| CLI | Grant `command` | Reuse semantics |
|---|---|---|
| `apes nest list` | `["nest","list"]` | One approval, reused forever. |
| `apes nest status` | `["nest","status"]` | One approval, reused forever. |
| `apes nest spawn <name>` | `["nest","spawn"]` (no name baked in) | One approval, any future spawn. Trade-off: a compromised local process running as the human can spawn arbitrary agents under that grant. Acceptable because spawn is reversible and audited. |
| `apes nest destroy <name>` | `["nest","destroy","<name>"]` | Per-name. Destroying each agent is its own approval. Destructive ops keep tighter scoping by design. |

Direct `curl` to the API is supported but you must fetch a grant token yourself. See `tests/auth-negative.sh` for an example token-fetch.

## Negative-test smoke

```bash
bash apps/openape-nest/tests/auth-negative.sh
```

Verifies: no-bearer → 401, garbage-bearer → 401, wrong-audience → 401, command-mismatch → 403.

## Why no in-daemon bridge supervisor

Earlier versions ran a per-agent process supervisor inside the Nest daemon to keep `openape-chat-bridge` instances alive. It was removed because:

- `apes agents spawn --bridge` already installs a system-domain `LaunchDaemon` per agent. launchd KeepAlive's it as the agent UID with the right PATH (the bridge binary is at `/Users/<agent>/.bun/bin/openape-chat-bridge`).
- The supervisor's children inherited the daemon's PATH (the human user's PATH, which doesn't include any agent's `~/.bun/bin`), so they crashlooped on `Command not found: openape-chat-bridge` while the launchd-domain bridge ran fine.
- Each crashloop produced an auto-approved YOLO grant — pushing one notification per cycle.

Single-source-of-truth on launchd. The Nest is now an API surface in front of `apes agents spawn|destroy`, nothing more.
