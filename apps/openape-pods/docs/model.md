# Pods model

One page on what Pods is made of. Each section links to the document that owns
the details; this page does not repeat them.

## Pods

A Pod is one bounded automation on the owner's Mac: a validated JavaScript
script (`export async function run(context)`), its schedule, ordinary variables,
secrets, run history, checkpoints and effect receipts. Each Pod acts as its own
DDISA agent identity, never as the owner. New Pods are paused and schedules start
disabled. The desktop app executes; the browser workspace at
`https://pods.openape.ai/workspace` and the phone inbox show the same data.
Details: [handbook](handbook.md), [central workspace](../../../docs/operations/pods-central-workspace.md).

## Data exchange

Pods exchange data through files in assigned directories or through external services.
Each script owns its input identity, idempotency and completion criteria. Private
checkpoints, progress, evidence and workspace files remain available.

The shared datastore, namespaces, declared work, owner questions and `domain` MCP
action were retired in issue 1529. Schema 54 removes their tables after a verified
private pre-upgrade backup. Historical approvals, effects, runs and identities stay.
A profile with a nonarchived script using the retired APIs cannot upgrade until
that script is migrated; old imports and activation requests are refused.

## Tags

A Pod can carry up to eight free tags (letters, digits and hyphens, stored
lowercase), for example a company or topic. Tags label only: no definition, pin
or hash includes them. The Automatisierungen view filters by tag, and Codex sets
them with the workspace command `tag`.

## Sandbox and grants

Two independent questions decide every call, and a call needs both:

- **Sandbox (can):** what a Pod can reach: assigned programs, HTTPS origins,
  folders, secrets, the sandbox level (isolated or owner reach) and the
  owner's denylist.
- **Grants (may):** what a Pod may do: each program command, HTTP destination
  and the Pod's own execution needs a grant that the Pod identity requests at the
  owner's identity provider.

Writes are recorded in the effect ledger with idempotency keys. A run can be interrupted at any
point and repeat, so an unknown outcome is reconciled by the script, not by the owner; a Pod is
only active or paused. Details: the sandbox section of [Claude Code](claude-code.md#sign-in-per-session).

## Decisions

Pods never decides for the owner; no model or schedule approves, denies or
chooses. Owner decisions come from:

- historical approvals, kept read-only for reference;
- grant requests of Pods, decided at the identity provider or in the owner's MCP
  session;
- secret requests through OpenApe Secrets.

The Decisions tab and the phone inbox list them all. Details: [handbook](handbook.md),
[relay and phone inbox](../../../docs/operations/pods-mobile.md).

## MCP owner session

Codex and Claude Code create and administer Pods through the
installed `openape-pods` MCP server. Each MCP connection needs a one-hour session
of the owner's own DDISA login: silently from the owner's `apes login` on this
Mac, otherwise through a browser sign-in confirmed in the app. Within the
session the client may do everything the tool offers, including deciding grants
that a Pod of this owner requested for itself. Without a session every call is
refused. Details: [Claude Code](claude-code.md), [MCP administration](chats.md),
runtime help (`pods_control` action `runtime`).
