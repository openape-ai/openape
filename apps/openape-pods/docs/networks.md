# Networks (retired)

Networks were the earlier way to connect Pods: a persistent definition over the
Pods of one group that routed items between the channels each member declared
in its `contract`. They were retired with issue 1465 (October 2026). Pods now
exchange data through files or external services. The intermediate shared datastore
was also retired in issue 1529. See [Pods model](model.md#data-exchange).

What the retirement means:

- The network runtime, its MCP action `networks`, the network workspace API,
  network gates, channels, joins and feedback transitions no longer exist.
  A script declaring `contract` is refused at validation, and `context.network`
  and `context.emit` no longer exist; use files or external services instead.
- Converting a profile to the new storage keeps archived history readable. Tags
  a network gave its members became their own tags, network denylists became
  the members' own denylists, and Pods that belonged to a network keep their
  data on the desktop: the browser workspace shows them but cannot change them.
- Portable packages that contain a network are refused; import their Pods from
  single-Pod packages.
- The mail network was replaced by separate Mail Pods that use external mail tooling
  and archive only messages the owner approved at the identity provider.

The design record of the former networks is kept in
[the network contract](../../../docs/architecture/pods-networks/contracts.md);
the replacement design is in
[autonomous Pods](../../../docs/architecture/pods-autonomous/design.md).
