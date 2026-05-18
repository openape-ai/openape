# Proxy Secrets

Inject API keys, OAuth tokens, and other long-lived credentials into outbound
HTTP(S) traffic for an agent — without ever giving the agent process plaintext
access to those secrets.

This document is the operator runbook for the long-running `openape-proxy`
daemon in `--global` mode (Phase 6). For the per-invocation ephemeral mode used
by `apes proxy -- <cmd>` without an existing daemon, see the
[`@openape/proxy` README](../packages/proxy/README.md).

## Overview

The setup has three actors on a single host:

1. **Patrick (the human owner)** — holds the secrets file in his own home
   directory at mode `0600`, or encrypted at rest with `age`. The agent's Unix
   user cannot read these files.
2. **The daemon** — runs as the agent's Unix user (e.g. `agent_iurio`),
   started by Patrick via `sudo -u`. It receives the plaintext secrets blob on
   stdin from Patrick's startup pipe, holds it in memory only, and never
   writes plaintext to disk.
3. **The agent's tooling** — runs as the agent's Unix user. It connects to the
   daemon via `OPENAPE_PROXY=127.0.0.1:18789` and ships requests through it.
   Outbound HTTPS is intercepted by the daemon (TLS-MITM with a per-user local
   CA), which injects the matching secret header before forwarding upstream.

The trust boundary is enforced by two independent mechanisms:

- **Filesystem isolation.** The secrets file lives under Patrick's home, mode
  `0600`. The agent's Unix user has no read permission. Even if the agent
  process is fully compromised, it cannot `cat` the file.
- **Process isolation.** The daemon's address space is separated from any
  agent-owned process by the kernel. The agent talks to the daemon over a
  loopback TCP socket; it sees only the request/response stream that the
  daemon chooses to expose. Plaintext secret values stay inside the daemon's
  heap.

HTTPS injection requires a TLS man-in-the-middle, which means the wrapped
subprocess must trust a CA that the daemon controls. We do **not** install
that CA into the system trust store. Instead, `apes proxy -- <cmd>` builds a
per-invocation trust bundle (system roots + the local CA) in a temp file and
exports it via `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `CURL_CA_BUNDLE`,
`REQUESTS_CA_BUNDLE`, and `GIT_SSL_CAINFO`. Trust is scoped to that one
subprocess and its children — nothing else on the box trusts the local CA.

## One-time setup

### 1. Create the agent's Unix user

`apes` does not create system users for you. This step is deliberately manual
so the operator stays in control of the host's account model.

**macOS:**

```bash
sudo dscl . -create /Users/agent_iurio
sudo dscl . -create /Users/agent_iurio UserShell /bin/zsh
sudo dscl . -create /Users/agent_iurio UniqueID 510
sudo dscl . -create /Users/agent_iurio PrimaryGroupID 20
sudo dscl . -create /Users/agent_iurio NFSHomeDirectory /Users/agent_iurio
sudo mkdir -p /Users/agent_iurio
sudo chown agent_iurio:staff /Users/agent_iurio
```

Adjust `UniqueID` to a free UID on your box (`dscl . -list /Users UniqueID`
shows what's taken). Add a password with `sudo dscl . -passwd /Users/agent_iurio`
if you need interactive login; for daemon-only use you can leave it password-less
and rely on `sudo -u`.

**Linux:**

```bash
sudo useradd -m -s /bin/bash agent_iurio
```

### 2. Log the agent into DDISA once

The daemon needs the agent's IdP identity to attribute outbound requests and
to look up the right policy. Run `apes login` as the agent's Unix user:

```bash
sudo -u agent_iurio apes login agent.iurio@example.com
```

This writes `~agent_iurio/.config/apes/auth.json`. The daemon reads that file
on startup; see the banner output in the
[Starting the daemon](#starting-the-daemon) section below.

You only do this once per device. The cached IdP token is exchanged for
SP-scoped tokens on demand by `@openape/cli-auth`.

## Secrets file format

The secrets file is TOML with `version = "1"` and a `[secrets.<name>]` table
per credential. Each entry has four required string fields.

```toml
version = "1"

[secrets.gh_pat]
target   = "api.github.com/*"
header   = "Authorization"
template = "Bearer ${value}"
value    = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

[secrets.openai]
target   = "api.openai.com/*"
header   = "Authorization"
template = "Bearer ${value}"
value    = "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

[secrets.smtp]
target   = "smtp.fastmail.com:587"
header   = "Authorization"
template = "Basic ${value}"
value    = "dXNlcjpwYXNzd29yZA=="
```

| Field      | Type     | Description                                                                 |
|------------|----------|-----------------------------------------------------------------------------|
| `target`   | `string` | Glob pattern matched against `host[:port]/path`. `*` is the only wildcard. |
| `header`   | `string` | The HTTP header to inject (e.g. `Authorization`, `X-API-Key`).             |
| `template` | `string` | Header value template. `${value}` is replaced with the `value` field.       |
| `value`    | `string` | The plaintext credential. Never logged, never written to disk by the daemon. |

The full TOML blob is capped at **4 KiB** by `parseSecretsBlob`. If you need
more secrets than fit, split them across multiple daemon instances on
different ports.

### At-rest encryption with `age`

If you don't want the secrets file as plaintext on disk, encrypt it with
[age](https://age-encryption.org/) and pipe the decrypted form straight into
the daemon's stdin:

```bash
# One-time: write the encrypted secrets file using your SSH key as recipient.
age --encrypt -R ~/.ssh/id_ed25519.pub -o ~/.secrets-iurio.age <plaintext-source>

# Each daemon start: decrypt to stdout, pipe to the daemon, never touch disk.
age --decrypt -i ~/.ssh/id_ed25519 ~/.secrets-iurio.age \
  | sudo -u agent_iurio openape-proxy --global --port 18789
```

`age` decrypts to stdout, which is consumed directly by `openape-proxy`. The
plaintext form never lands in the filesystem.

If you prefer plaintext with strict permissions instead, store the file under
your home with `chmod 600 ~/.secrets-iurio.toml` and feed it via redirection:

```bash
sudo -u agent_iurio openape-proxy --global --port 18789 < ~/.secrets-iurio.toml
```

Either way, Patrick is the only Unix user with read access to the source.

## Starting the daemon

Foreground form (use this first to verify the wiring):

```bash
sudo -u agent_iurio openape-proxy --global --port 18789 < ~/.secrets-iurio.toml
```

Expected stdout:

```
[openape-proxy] identity: agent.iurio@example.com (https://id.openape.ai)
[openape-proxy] secrets: gh_pat, openai, smtp
[openape-proxy] export OPENAPE_PROXY=127.0.0.1:18789
[openape-proxy] listening on 127.0.0.1:18789
```

The first line confirms the daemon read the agent's `auth.json`. The second
lists the secrets it loaded by name (never values). The third is the
copy-pasteable env-var hint for shells that will use the daemon. The fourth is
the canonical "ready" banner that any spawner can grep.

`Ctrl-C` stops the daemon. To run it under a process supervisor (launchd /
systemd), wrap the same command in a unit file that pipes the secrets blob in
on `ExecStart`. Keep the secrets source readable only by the supervisor's
account.

## Pointing tools at the daemon

Once the daemon is up, any shell on the same host can route a wrapped command
through it:

```bash
export OPENAPE_PROXY=127.0.0.1:18789

apes proxy -- gh repo list
apes proxy -- curl https://api.github.com/user
apes proxy -- npm publish
```

`apes proxy --` does three things on every invocation:

1. Confirms `~/.openape/proxy/ca.crt` exists (the local CA the daemon writes
   on first start).
2. Builds a per-invocation trust bundle in a temp file (system roots +
   local CA).
3. Spawns the wrapped command with `HTTPS_PROXY=http://127.0.0.1:18789` and
   the trust bundle wired into every common TLS env var.

The wrapped command sends its requests through the daemon. The daemon
intercepts the TLS handshake, mints a leaf cert from its local CA for the
target host, terminates the connection, matches the request against the
secrets table, injects the appropriate header, and forwards upstream. The
upstream response streams back unchanged.

## Match resolution

When the daemon receives a request, it walks the secrets table to pick at
most one entry to inject:

- **Glob syntax.** Only `*` is a wildcard. Other regex/glob metacharacters
  (`?`, `[]`, `**`) are treated as literal characters.
- **Tiebreaker.** The longest literal prefix wins. If two entries have the
  same literal prefix, the one defined first in the TOML file wins.
- **At most one match.** The daemon never injects more than one secret into a
  single request, even if multiple targets would match.

Examples against the table above:

| Request                                  | Matched secret |
|------------------------------------------|----------------|
| `GET https://api.github.com/user`        | `gh_pat`       |
| `POST https://api.openai.com/v1/chat`    | `openai`       |
| `CONNECT smtp.fastmail.com:587`          | `smtp`         |
| `GET https://example.com/`               | (no match)     |

Requests that don't match any secret are forwarded unchanged. They still go
through the daemon's policy / audit pipeline like any other request.

## Rotation

Phase 6 rotation is restart-to-rotate. Update the source (plaintext file or
`age`-encrypted blob), then:

1. Stop the daemon (`Ctrl-C`, or restart its supervisor unit).
2. Start it again with the new stdin payload.

In-flight requests on the old daemon are dropped at the TCP layer when the
process exits; the wrapper subprocess sees a connection error and the user's
tool retries on its own. There is no cross-daemon hot reload in v1.

A future `v2` may add a control-socket `reload` command so rotation does not
require a restart. Until that lands, plan for a brief gap when you rotate.

## Trust model FAQ

**Why a subprocess-scoped CA, not a system-wide install?**
Installing the local CA into macOS Keychain or `/etc/ssl/certs` would let any
process on the box trust it — not just the wrapped subprocess. That is too
much trust for too little gain: the daemon is the only thing that should ever
need it. Keeping the CA in a per-invocation trust bundle scopes the blast
radius to the wrapped subprocess and its children, requires no admin step,
and leaves no persistent footprint. We can revisit this if there's a real
need.

**Why doesn't the agent see the secret?**
The plaintext lives in the secrets file, which is in Patrick's home with mode
`0600` (or `age`-encrypted). The agent's Unix user has no read permission.
The plaintext also lives in the daemon's heap after stdin is drained, but the
daemon and the agent run as different Unix users — the kernel separates their
address spaces. The agent only ever sees the daemon's TCP socket, which
returns proxied responses, never the secrets table.

**What if I want native `HTTPS_PROXY=... curl` without the wrapper?**
Not supported in v1. Without `apes proxy --` the wrapped command has no path
to the daemon's local CA, and the TLS handshake will fail with an unknown
issuer. A future `v2` may add an opt-in `apes proxy ca install` flow that
trusts the local CA system-wide for users who explicitly want native
`HTTPS_PROXY` to work; it will remain off by default.

## Runtime requirement

The daemon must run under **Node**, not Bun. Bun's `node:tls` compatibility
layer does not handle the `TLSSocket`-on-existing-socket pattern that the
CONNECT-MITM pipeline uses — the inner TLS handshake never completes and
clients hang until timeout. The daemon detects Bun at startup and refuses
with a clear error.

```bash
# Preferred — invokes the published bin (shebang: #!/usr/bin/env node):
sudo -u agent_iurio openape-proxy --global --port 18789 < ~/.secrets-iurio.toml

# Equivalent direct invocation:
sudo -u agent_iurio node /path/to/openape-proxy/dist/index.js --global \
  --port 18789 < ~/.secrets-iurio.toml
```

Inline mode (`apes proxy -- <cmd>` ephemeral path, no `OPENAPE_PROXY`) is
unaffected by this restriction and works under either runtime.

## Limitations and known gotchas

- **Wrapper-only HTTPS.** TLS-MITM injection works only for tools spawned via
  `apes proxy -- <cmd>`. Native `curl` calls without the wrapper will fail
  the cert check.
- **No TLS pinning.** Tools that pin the upstream certificate (some mobile
  SDKs, certain native binaries) cannot be intercepted. They will refuse to
  trust the daemon's leaf cert and fail to connect. There is no workaround
  short of disabling the pin in the tool itself.
- **Plain TCP / non-HTTP.** The daemon speaks HTTP and HTTPS only. Raw TCP,
  WebSocket-over-non-HTTP, or other protocols are not supported.
- **Port collisions.** The default `--port 18789` may collide with another
  service. Override with `--port <free-port>` and update `OPENAPE_PROXY` to
  match.
- **Restart to rotate.** No hot reload in v1. Plan for a brief gap when
  rotating credentials.
- **stdin size cap.** The TOML blob must fit in 4 KiB. Split across multiple
  daemon instances on different ports if you need more secrets than fit.
- **Go-based clients on macOS** (`gh`, `kubectl`, `terraform`, `helm`, …).
  Two layers to be aware of:
  1. **Cert encoding** — fixed in Phase 6. Leaf certs are tagged
     `UTF8String` so Go's strict `crypto/x509` parser accepts them. If you
     hit `invalid PrintableString` your daemon binary predates this fix.
  2. **Trust-store discovery** — Go on macOS reads only the system
     Keychain for `SystemCertPool()`. It **does not** honor `SSL_CERT_FILE`
     on macOS even when set, so the wrapper's per-invocation trust bundle
     is invisible to a Go client and the handshake fails with
     `certificate is not trusted`. On **Linux**, Go does honor
     `SSL_CERT_FILE` and these clients work via the wrapper. On macOS,
     wait for v2's `apes proxy ca install` (opt-in Keychain trust) or
     install the CA manually:
     ```bash
     sudo security add-trusted-cert -d -r trustRoot \
       -k /Library/Keychains/System.keychain \
       ~/.openape/proxy/ca.crt
     ```
     Manual install gives the CA system-wide trust — **only do this if you
     understand the implications** (any Go binary on the host will trust
     daemon-minted leaf certs while the daemon is running).
