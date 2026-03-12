# @openape/proxy

HTTP forward proxy for AI agent traffic control. Sits between an agent and the internet, enforcing grant-based access rules before forwarding requests.

```
┌─────────┐   HTTP (plain)   ┌─────────────┐   HTTPS   ┌──────────┐
│  Agent   │ ──────────────► │  OpenApe     │ ────────► │ Upstream │
│          │ ◄────────────── │  Proxy       │ ◄──────── │ Server   │
└─────────┘                  └──────┬──────┘           └──────────┘
                                    │
                             grant request
                                    │
                             ┌──────▼──────┐
                             │     IdP     │
                             │   (Grants)  │
                             └─────────────┘
```

The proxy operates at the application level (not CONNECT tunnel) — it sees the full request (domain, method, path, headers, body) and can match against fine-grained rules.

## Installation

```bash
npm install @openape/proxy
```

## Usage

```bash
openape-proxy --config config.toml
openape-proxy --config config.toml --dry-run   # Log only, no blocking
```

## Configuration

Configuration uses TOML format:

```toml
[proxy]
listen = "127.0.0.1:9090"
idp_url = "https://id.example.com"
agent_email = "agent@example.com"
default_action = "block"
audit_log = "/var/log/openape-proxy/audit.jsonl"

# Always allow (no grant needed)
[[allow]]
domain = "*.internal.example.com"
methods = ["GET"]
note = "Internal read-only access"

# Always deny (regardless of grants)
[[deny]]
domain = "169.254.169.254"
note = "Cloud metadata endpoint"

# Require a grant
[[grant_required]]
domain = "api.github.com"
path = "/repos/*/issues"
methods = ["POST"]
grant_type = "once"
permissions = ["write:issues"]
duration = 3600
```

### Proxy Options

| Option | Type | Description |
|--------|------|-------------|
| `listen` | `string` | Bind address and port |
| `idp_url` | `string` | IdP URL for grant requests |
| `agent_email` | `string` | Agent identity |
| `default_action` | `string` | Action when no rule matches (see below) |
| `audit_log` | `string` | Path to JSONL audit log file |

### Rule Options

| Option | Type | Description |
|--------|------|-------------|
| `domain` | `string` | Domain pattern (supports `*` wildcards) |
| `methods` | `string[]` | HTTP methods (optional — all if omitted) |
| `path` | `string` | Path glob pattern (optional) |
| `note` | `string` | Human-readable note |

Grant rules additionally support:

| Option | Type | Description |
|--------|------|-------------|
| `grant_type` | `string` | `'once'`, `'timed'`, or `'always'` |
| `permissions` | `string[]` | Required permissions |
| `duration` | `number` | Grant validity in seconds (for `timed`) |

## Rule Hierarchy

Rules are evaluated in this order — first match wins:

1. **`deny`** — Always blocked, no exceptions
2. **`allow`** — Always permitted, no grant needed
3. **`grant_required`** — Permitted only with a valid grant
4. **`default_action`** — Applied when no rule matches

## Default Actions

| Action | Behavior |
|--------|----------|
| `block` | Reject the request immediately |
| `request` | Request a grant from the IdP and wait for approval (blocking) |
| `request-async` | Request a grant and return a pending response to the agent |

## Agent Authentication

The agent authenticates to the proxy via the `Proxy-Authorization` header using a JWT from the existing Ed25519 challenge-response flow:

```
Proxy-Authorization: Bearer <JWT>
```

## Agent Integration

Configure your agent to use the proxy via environment variables:

```bash
export HTTP_PROXY=http://127.0.0.1:9090
export HTTPS_PROXY=http://127.0.0.1:9090
```

The agent sends plain HTTP to the proxy on localhost. The proxy terminates the connection and forwards the request as HTTPS to the upstream server.

## Audit Log

All requests are logged in JSONL format:

```json
{
  "ts": "2025-01-15T10:30:00.000Z",
  "agent": "agent@example.com",
  "action": "grant_approved",
  "domain": "api.github.com",
  "method": "POST",
  "path": "/repos/owner/repo/issues",
  "grant_id": "550e8400-e29b-41d4-a716-446655440000",
  "rule": "grant_required",
  "waited_ms": 1250
}
```

Possible `action` values: `allow`, `deny`, `grant_approved`, `grant_denied`, `grant_timeout`, `error`.

## License

[AGPL-3.0-or-later](./LICENSE)
