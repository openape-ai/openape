---
name: openape-grapes
description: "OpenAPE Grant Management — request, approve, revoke, and delegate authorization grants via the grapes CLI"
metadata:
  openclaw:
    emoji: "\U0001F347"
    requires:
      bins:
        - grapes
    install:
      - kind: node
        package: "@openape/grapes"
        bins:
          - grapes
---

# OpenAPE Grant Management (grapes)

CLI for managing authorization grants in the OpenAPE/DDISA ecosystem. Grants are the central authorization primitive — every privileged action (via `apes`/`escapes` or `shapes`) requires a grant approved by a human.

## Prerequisites

- **`grapes` binary** installed (`npm install -g @openape/grapes`)
- Access to an OpenAPE IdP (e.g. `https://id.openape.at`)

## Authentication

### Interactive Login (PKCE)

Opens a browser for human authentication:

```bash
grapes login --idp https://id.openape.at
```

### Agent Login (Ed25519 Key)

For non-interactive agents:

```bash
grapes login --idp https://id.openape.at --key ~/.apes/keys/deploy.key --email agent+deploy@example.com
```

### Check Identity

```bash
grapes whoami
```

Output: email, type (human/agent), IdP URL, token expiry.

### Logout

```bash
grapes logout
```

## Grant Lifecycle

```
pending → approved → used (consumed by apes/shapes)
       → denied
       → revoked (by owner, at any time)
```

**Grant types:**
- `once` — single use, consumed on execution (default)
- `timed` — valid for a time window
- `always` — standing grant (use sparingly)

## Requesting Grants

### Request a Generic Grant

```bash
grapes request "<command>" --audience <service> [--approval once|timed|always] [--reason "<text>"] [--host <hostname>] [--wait]
```

- `--audience` — target service: `apes` (privilege elevation), `proxy` (HTTP gateway), or custom
- `--wait` — block until the grant is approved or denied (polls every 3s, timeout 5min)

Example:

```bash
grapes request "apt update" --audience apes --reason "security patches" --wait
```

### Request a Structured Capability Grant (for shapes)

```bash
grapes request-capability <cli-id> --resource <resource> --action <action> [--selector <selector>] [--approval once|timed|always] [--reason "<text>"] [--wait]
```

Uses the shapes adapter to build a structured grant request with resource chains and permissions.

Example:

```bash
grapes request-capability gh --resource "repo:openape-ai/protocol" --action "pull_request:create" --wait
```

## Checking Grant Status

### List Grants

```bash
grapes list [--status pending|approved|denied|revoked|used] [--limit <n>] [--json]
```

### Get Grant Details

```bash
grapes status <grant-id> [--json]
```

## Grant Approval (for approvers)

### Approve a Grant

```bash
grapes approve <grant-id>
```

### Deny a Grant

```bash
grapes deny <grant-id>
```

## Using Grant Tokens

### Get a Grant Token JWT

```bash
grapes token <grant-id>
```

Outputs the raw JWT to stdout (pipeable). Use with `apes --grant` or `shapes --grant`.

### Request + Wait + Execute (all-in-one)

```bash
grapes run <audience> "<command>" [--approval once|timed|always] [--reason "<text>"] [--apes-path <path>]
```

For `apes` audience: requests grant, waits for approval, fetches token, executes via `apes --grant`.
For other audiences: outputs the token to stdout.

Example:

```bash
grapes run apes "systemctl restart nginx" --reason "deploy v2.0"
```

## Revoking Grants

```bash
grapes revoke <grant-id>
```

## Delegation

Delegate authorization to another identity:

```bash
grapes delegate --to <email> --at <audience> [--scopes <comma-separated>] [--approval once|timed|always] [--expires <ISO8601>]
```

Example:

```bash
grapes delegate --to agent+ci@example.com --at apes --scopes "apt,systemctl" --approval timed --expires 2026-04-01T00:00:00Z
```

### List Delegations

```bash
grapes delegations [--json]
```

## Agent Workflow

Typical flow for an agent that needs to execute a privileged command:

```
1. grapes login --idp <url> --key <key> --email <agent-email>
2. grapes request "<command>" --audience apes --reason "<why>" --wait
3. GRANT_ID=$(grapes list --status approved --json | jq -r '.data[0].id')
4. TOKEN=$(grapes token $GRANT_ID)
5. apes --grant $TOKEN -- <command>
```

Or use the all-in-one shortcut:

```bash
grapes run apes "<command>" --reason "<why>"
```

## Combined Workflow with shapes

When using shapes adapters (see `openape-shapes` skill):

```
1. shapes adapter install <id>                    # Install adapter (once)
2. shapes explain -- <cli> <args>                 # Understand what permission is needed
3. grapes request-capability <cli> --resource <r> --action <a> --wait  # Request structured grant
4. TOKEN=$(grapes token <grant-id>)
5. shapes --grant $TOKEN -- <cli> <args>          # Execute via shapes
```

## Configuration

Config file: `~/.config/grapes/config.json`

```json
{
  "defaults": {
    "idp": "https://id.openape.at"
  }
}
```

Auth credentials stored in: `~/.config/grapes/auth.json`

Environment variable: `GRAPES_IDP` overrides the default IdP URL.

## Guardrails

- **Never auto-approve grants.** Every grant requires explicit human decision.
- **Use `once` grants** unless a standing grant is explicitly needed.
- **Respect denials** — do not retry a denied grant. Ask the user for guidance.
- **Handle timeouts gracefully** — if no approver responds within 5min, inform the user.
- **One command per grant** — do not chain commands; use separate grant requests.
- **Prefer `grapes run`** for simple privilege elevation (combines request + wait + execute).
- **Use `request-capability`** when working with shapes adapters for structured permissions.
