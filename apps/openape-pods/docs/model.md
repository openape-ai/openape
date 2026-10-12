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

## Shared data and work

Pods never call each other and never name another Pod. A Pod writes its results
to shared data and other Pods find their own work there (issue 1465):

- **Namespaces** are hierarchical paths such as `delta-mind/mail/messages`. Each
  has exactly one writer (a Pod or the owner) and explicitly listed reader Pods;
  nothing is inherited from a parent path. The owner defines them with the MCP
  action `domain`.
- **Declared work:** a script exports `work`, naming an operation, the
  namespace it reads, the namespace it writes its results to and the input fields
  its result depends on. Every input whose fields changed becomes one work item;
  an unchanged input is never processed again, also when its result was negative.
  Claims are tied to the run; a result is refused when the input changed meanwhile.
- **Owner questions** (`context.decisions.ask`) become owner-written answers the
  asking Pod reads; **approvals** (`context.approvals.request`) bind one action to
  one object and are decided at the identity provider.
- Private Pod state stays in checkpoints and the Pod workspace. Large files stay
  in assigned folders; records name their path and digest.

The scheduler skips a scheduled run of a Pod that declares work and has nothing
ready. Details: runtime help (`pods_control` action `runtime`, section
`sharedData`). The network runtime of earlier versions was retired;
[networks](networks.md) keeps its history.

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

Writes are recorded in the effect ledger with idempotency keys; an unknown outcome waits for
owner reconciliation. Details: the sandbox section of [Claude Code](claude-code.md#sign-in-per-session).

## Decisions

Pods never decides for the owner; no model or schedule approves, denies or
chooses. Owner decisions come from:

- owner questions of Pods (pick an option on the Decisions tab or in the phone
  inbox) and object approvals (decided at the identity provider);
- held work and uncertain external actions that need the owner's observation;
- grant requests of Pods, decided at the identity provider or in the owner's MCP
  session;
- secret requests through OpenApe Secrets;
- unknown deliveries that need the owner's observation at the destination.

The Decisions tab and the phone inbox list them all. Details: [handbook](handbook.md),
[relay and phone inbox](../../../docs/operations/pods-mobile.md).

## MCP owner session

Codex and Claude Code create and administer Pods and shared data through the
installed `openape-pods` MCP server. Each MCP connection needs a one-hour session
of the owner's own DDISA login: silently from the owner's `apes login` on this
Mac, otherwise through a browser sign-in confirmed in the app. Within the
session the client may do everything the tool offers, including deciding grants
that a Pod of this owner requested for itself. Without a session every call is
refused. Details: [Claude Code](claude-code.md), [MCP administration](chats.md),
runtime help (`pods_control` action `runtime`).
