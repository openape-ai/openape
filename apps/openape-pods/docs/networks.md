# Networks

Networks are the only way to connect Pods. A network is a persistent, owner-bound
definition over Pods of one group: each member declares which channels it takes
and gives, and the network routes every item between them. Connections are never
drawn or stored; they follow from the member contracts and the network
definition. The complete contract, storage and recovery model is in the
[network contract](../../../docs/architecture/pods-networks/contracts.md).

Workflows (sequence chains and bounded channel graphs) and their conversion to
networks were removed with
[issue 1455](https://repos.openape.ai/patrick/monorepo/issues/1455) (M4).
Schema 45 archives every remaining workflow and every Pod that only workflows
used; a Pod that is a network member or keeps its own enabled schedule stays as
it is. The workflow tables stay unread until the baseline schema; the verified
pre-upgrade copy of the profile keeps every row.

## Member contract

```js
export const contract = {
  takes: ['mail.category.invoice'],
  gives: ['invoice.filed'],
  summary: 'PDF in Buchhaltung',
}
```

- At most 8 taken and 16 given channels; the summary has 1 to 40 characters.
  Channel names match `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,4}$` and have at
  most 64 characters. A script without `contract` cannot join a network.
- A member without `takes` is a source. Sources emit with
  `context.network.emit({ channel, key, sourceItemId, sourceVersion, payload })`
  and provider-stable identities and versions; never derive a version from the
  run time.
- Consumers read `context.items` (the claimed inputs of one invocation) and emit
  with `context.emit(channel, { key, data, reason?, confidence? })`. Emits are
  accepted only when the invocation settles successfully, so a failed run hands
  nothing on and a retry cannot duplicate.
- Validation answers `graph.contract` with two synthetic items per taken channel
  and refuses any emit outside `contract.gives`.

## Definition

A network declares typed channels (`schemaVersion` and a JSON schema per
channel), its members (with an optional source schedule and case
serialization), routes, joins and bounded feedback:

- **Routes** sit between members. `approve` holds items until the owner decided
  the batch at the identity provider, which approves or denies each item;
  denied items go to `excluded`. `choose` holds items until the owner picked one
  option per item on the Entscheidungen tab. No Pod or model approves, denies or
  chooses.
- **Joins** let a member wait for all inputs of one case.
- **Feedback** declares one bounded transition back to an earlier channel with
  a delay, a hop limit and a maximum case age; any other cycle is refused.
- Shared values configure the declared public fields of the member definitions.
  Members read them in `context.config`; every shared string value also appears
  in `context.variables`.

A network is created paused from a reviewed setup fingerprint, activated
separately and archived only after an archive review (`archivePreview`, then
`archiveNetwork` with its fingerprint) shows no unsettled work. Codex and Claude
Code create and change networks through the `networks` MCP action; see
[Claude Code](claude-code.md) and `runtime.networks`.

## Runtime ports

A network member uses the same rules as a standalone Pod for assigned mail
reads, read-only CLI operations on sources (100 reads per invocation), Jev and
`agent.run`. Scoped data (`context.data`) and artifacts (`context.artifacts`)
require explicit permissions. A consumer whose every input comes from an approve
route may archive the approved mail with
`context.network.archive({ application, mailbox })`; each move is bound to the
owner's grant of that item and re-verified immediately before the move.

## Reading networks

The **Automatisierungen** tab shows every network as a group on one map next to
standalone Pods and the systems they read and write; the MCP `workspace` tool
returns the same read model with `{ type: "read", view: "map" }`. Dotted lines
carry the recorded deliveries of the last 24 hours; a count is not proof that a
downstream external effect succeeded. Open choices and pending approvals are
counted on the **Entscheidungen** tab.

## Portable packages

A network exports as a package of kind `network`. Format version 1 keeps the
composition fields `calls` and node `after`/`handoff`, which are always empty;
packages of the removed kinds `sequence` and `channels` are refused on import.
