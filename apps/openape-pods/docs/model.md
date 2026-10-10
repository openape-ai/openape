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

## Networks

Networks are the only way to connect Pods. Each member script declares the
channels it takes and gives; the network definition adds typed channels, member
sources, routes, joins and bounded feedback. Connections follow from these
declarations and are never drawn. A Pod that is not in a network runs on its own
schedule. Details: [networks](networks.md).

## Sandbox and grants

Two independent questions decide every call, and a call needs both:

- **Sandbox (can):** what a Pod can reach: assigned programs, HTTPS origins,
  folders, secrets, the sandbox level (isolated or owner reach) and the
  owner's denylist.
- **Grants (may):** what a Pod may do: each program command, HTTP destination
  and the Pod's own execution needs a grant that the Pod identity requests at the
  owner's identity provider.

Network members use exactly the same rules as standalone Pods. Writes are
recorded in the effect ledger with idempotency keys; an unknown outcome waits for
owner reconciliation. Details: the sandbox section of [Claude Code](claude-code.md#sign-in-per-session).

## Decisions

Pods never decides for the owner; no model or schedule approves, denies or
chooses. Owner decisions come from:

- network routes: `choose` (pick an option per item on the Decisions tab or in
  the phone inbox) and `approve` (approve or deny a batch at the identity provider);
- grant requests of Pods, decided at the identity provider or in the owner's MCP
  session;
- secret requests through OpenApe Secrets;
- unknown deliveries that need the owner's observation at the destination.

The Decisions tab and the phone inbox list them all. Details: [handbook](handbook.md),
[relay and phone inbox](../../../docs/operations/pods-mobile.md).

## MCP owner session

Codex and Claude Code create and administer Pods and networks through the
installed `openape-pods` MCP server. Each MCP connection needs a one-hour session
of the owner's own DDISA login: silently from the owner's `apes login` on this
Mac, otherwise through a browser sign-in confirmed in the app. Within the
session the client may do everything the tool offers, including deciding grants
that a Pod of this owner requested for itself. Without a session every call is
refused. Details: [Claude Code](claude-code.md), [MCP administration](chats.md),
runtime help (`pods_control` action `runtime`).
