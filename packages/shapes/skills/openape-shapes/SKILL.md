---
name: openape-shapes
description: "OpenAPE Shapes — grant-aware CLI wrappers with adapter registry for structured, auditable command execution"
metadata:
  openclaw:
    emoji: "\U0001F533"
    requires:
      bins:
        - shapes
    install:
      - kind: node
        package: "@openape/shapes"
        bins:
          - shapes
---

# OpenAPE Shapes (grant-aware CLI wrappers)

Shapes wraps arbitrary CLI tools with structured adapters that describe what each command does, what permissions it needs, and how to verify execution. Every command runs through the OpenAPE grant system — no autonomous execution of wrapped commands.

## Prerequisites

- **`shapes` binary** installed (`npm install -g @openape/shapes`)
- **`grapes` CLI** for grant management (see `openape-grapes` skill)
- For privilege elevation: **`escapes`** binary (see `openape-escapes` skill)

## Adapter Registry

Adapters are TOML files that describe CLI tools: their commands, operations, required permissions, and resource chains. The registry is hosted on GitHub and cached locally.

### Search Adapters

```bash
shapes adapter search "<query>"
```

Searches by ID, name, description, tags, and category.

### Install an Adapter

```bash
shapes adapter install <id> [--local] [--refresh]
```

- Default: installs to `~/.openape/shapes/adapters/`
- `--local`: installs to `.openape/shapes/adapters/` (project-scoped)
- `--refresh`: bypass the registry cache (useful after pushing new adapters)

### List Adapters

```bash
# List locally installed adapters
shapes adapter list

# List all adapters in the remote registry
shapes adapter list --remote

# JSON output
shapes adapter list --json
```

### Adapter Details

```bash
shapes adapter info <id>
```

Shows: ID, name, description, category, tags, author, executable, digest, install status.

### Update Adapters

```bash
# Update a specific adapter
shapes adapter update <id> [--yes]

# Update all installed adapters
shapes adapter update [--yes]
```

Without `--yes`, shows digest changes and requires confirmation (existing grants for updated adapters are invalidated).

### Verify Adapter Integrity

```bash
shapes adapter verify <id> [--local]
```

Checks the installed adapter's digest against the registry.

## Adapter Resolution Order

When shapes looks for an adapter, it searches these directories in order:

1. `.openape/shapes/adapters/` — project-local
2. `~/.openape/shapes/adapters/` — user-global
3. `/etc/openape/shapes/adapters/` — system-wide
4. Built-in adapters bundled with the shapes package

The first matching adapter wins. Matching is by adapter ID, filename, or executable name.

## Explaining Commands

Before requesting a grant, understand what permission a command needs:

```bash
shapes explain [--adapter <file>] -- <cli> <args...>
```

Output (JSON):

```json
{
  "adapter": "gh",
  "source": "~/.openape/shapes/adapters/gh.toml",
  "operation": "pr.create",
  "display": "Create pull request",
  "permission": "repo:write",
  "resource_chain": ["repo:openape-ai/protocol", "pr:new"],
  "exact_command": false,
  "adapter_digest": "SHA-256:abc123..."
}
```

The `--` separator is mandatory — everything after it is the wrapped command.

## Requesting + Executing Commands

### All-in-one: Request Grant and Execute

```bash
shapes request [--idp <url>] [--approval once|timed|always] [--reason "<text>"] [--adapter <file>] -- <cli> <args...>
```

This:
1. Loads the adapter for the CLI tool
2. Resolves the command to an operation + permission
3. Creates a grant request at the IdP
4. Waits for human approval
5. Fetches the grant token
6. Executes the command with the grant

Example:

```bash
shapes request --reason "merge release PR" -- gh pr merge 42 --squash
```

### Execute with an Existing Grant Token

```bash
shapes --grant <jwt> [--adapter <file>] -- <cli> <args...>
```

Use when you already have a grant token (e.g. from `grapes token`).

Example:

```bash
TOKEN=$(grapes token $GRANT_ID)
shapes --grant $TOKEN -- gh pr merge 42 --squash
```

## Grant Verification

When executing with `--grant`, shapes:

1. Verifies the JWT signature against the IdP's JWKS
2. Checks that the command matches the grant's `cmd_hash`
3. Consumes the grant at the IdP (for `once` grants)
4. Executes the command

If verification fails, the command is **not** executed.

## Full Agent Workflow

Complete flow for an agent executing a CLI command through shapes:

```
1. shapes adapter install gh                        # Install adapter (once)
2. shapes explain -- gh pr list --repo myorg/myrepo # Understand what it does
3. shapes request --reason "list PRs" -- gh pr list --repo myorg/myrepo
   # → Creates grant, waits for approval, executes on approval
```

Or step-by-step with grapes for more control:

```
1. shapes adapter install gh                                     # Install adapter
2. shapes explain -- gh pr merge 42 --squash                     # Check permission needed
3. grapes request-capability gh --resource "repo:myorg/myrepo" \
     --action "pr:merge" --wait                                  # Request grant
4. TOKEN=$(grapes token <grant-id>)                              # Get token
5. shapes --grant $TOKEN -- gh pr merge 42 --squash              # Execute
```

### With Privilege Elevation (escapes)

For commands that need root:

```
1. grapes request "apt update" --audience escapes --reason "patches" --wait
2. TOKEN=$(grapes token <grant-id>)
3. escapes --grant $TOKEN -- apt update
```

Use `escapes` directly (not shapes) when the command needs root privileges. Shapes is for user-level CLI wrappers.

## Programmatic API

The shapes package also exports a programmatic API:

```typescript
import { fetchRegistry, findAdapter, installAdapter, loadAdapter } from '@openape/shapes'

// Browse the registry
const index = await fetchRegistry()
const entry = findAdapter(index, 'gh')

// Install an adapter
await installAdapter(entry)

// Load and use an adapter
const loaded = loadAdapter('gh')
```

## Troubleshooting

### Newly pushed adapter not found

The registry is cached locally for 1 hour at `~/.openape/shapes/cache/registry.json`. After pushing new adapters to the shapes-registry repo, use `--refresh` to bypass the cache:

```bash
shapes adapter install <id> --refresh
shapes adapter list --remote --refresh
```

Or manually delete the cache:

```bash
rm ~/.openape/shapes/cache/registry.json
```

Note: GitHub's raw CDN also caches files. If `--refresh` still shows stale data, wait 1–2 minutes for the CDN to propagate.

### Grant not reused (adapter_digest mismatch)

`shapes request` checks for existing approved grants via `findExistingGrant()`. If it creates a new grant instead of reusing an existing one, the most common cause is an **adapter digest mismatch**: the grant was created with an older version of the adapter.

**How it happens:**
1. You create a grant with adapter digest `SHA-256:abc...`
2. The adapter is updated in the registry (new operations, fixes)
3. You run `shapes adapter update <id> --yes` → local digest changes to `SHA-256:def...`
4. `findExistingGrant()` skips the old grant because `req.execution_context.adapter_digest !== resolved.digest`

**Fix:**
1. Update the local adapter: `shapes adapter update <id> --yes`
2. Create a **new** grant — the old grant with the old digest will never match
3. Revoke the old grant if no longer needed

**Important:** Adapter updates invalidate ALL existing grants for that adapter. This is intentional — the adapter defines what permissions mean, so a changed adapter requires re-approval.

### Existing grant not found (wrong resource chain)

If you created a grant via `grapes request-capability` and `shapes request` doesn't find it, check that the resource chain matches. The covering logic requires:

- Same `cli_id` (adapter ID)
- Same `action`
- Same number of resource chain entries
- Each granted resource covers the required resource (wildcard granted selector covers any required selector)

Example: a grant with `--resource account --resource mail --action list` covers `o365-mail-cli mail list --account foo@bar.com` because the granted `account` resource has no selector (wildcard) which covers `{email: foo@bar.com}`.

## Guardrails

- **Never execute wrapped commands without a grant.** The `--grant` flag or the `shapes request` flow is mandatory.
- **Verify adapter digests** before trusting them, especially after updates.
- **Use `shapes explain`** before requesting grants to understand what permission you're asking for.
- **Prefer `shapes request`** (all-in-one) for simple flows; use grapes step-by-step for complex flows.
- **Do not bypass the adapter system** by running CLI commands directly — shapes ensures auditability and grant binding.
- **Update adapters carefully** — digest changes invalidate existing grants.
