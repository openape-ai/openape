---
"@openape/proxy": minor
---

proxy: distinguish DNS-unresolvable hosts from private/loopback IPs (502 vs 403)

Previously the SSRF check (`isPrivateOrLoopback`) collapsed three different
egress conditions into one boolean and surfaced all of them as **403
Forbidden** with audit `rule=ssrf-blocked`:

- the host resolves to a private/loopback IP (a real policy refusal)
- DNS returns no A/AAAA records (NXDOMAIN, NODATA)
- DNS query itself errors out (timeout, SERVFAIL)

That made `apes proxy -- curl https://example.at` (a typo) come back as a
403 — misleading, because the proxy didn't refuse on policy, it just
couldn't reach an upstream.

New: `checkEgress(hostname)` returns a discriminated result and callers
branch on it.

| outcome           | response               | audit `rule`                  |
|-------------------|------------------------|-------------------------------|
| `ok`              | forward                | (n/a — proceeds to rules)     |
| `private`         | **403 Forbidden**      | `ssrf-blocked`                |
| `unresolvable`    | **502 Bad Gateway**    | `dns-unresolvable (<reason>)` |

The `unresolvable` reason is `no-records` (NXDOMAIN/NODATA) or `dns-error`
(query failure). The audit action is `error` for unresolvable, distinct
from `deny` so dashboards can separate "policy stopped this" from "we
couldn't reach the upstream".

Both proxy entry points are updated: HTTP forward-proxy
(`handleRequest`) and CONNECT tunnel (`handleConnect`).

`isPrivateOrLoopback` is kept as a deprecated boolean shim for any
out-of-tree caller; new callers should use `checkEgress`.

Drive-by note on DNS-rebinding: the old "block on uncertainty" rationale
was a weak hedge — a careful attacker can still race the resolution
between our check and the kernel's `connect()`. The proper mitigation is
pinning the resolved IP across the actual socket call; conflating
unresolvable with private was costing us correctness for typos without
buying meaningful safety.
