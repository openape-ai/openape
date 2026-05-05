---
'@openape/core': minor
---

`resolveDDISA` now caches negative results too. Closes #306.

Previously, domains without a `_ddisa.{domain}` TXT record re-queried DNS (or DoH) on every call. That added latency on the happy path for users from non-DDISA domains and gave attackers a cheap DoS vector via crafted `/authorize?login_hint=foo@no-ddisa.com` requests.

Negative entries get a shorter TTL than positive ones (60s vs 300s default) so that a domain which *just* added a DDISA record gets picked up promptly. Tunable per-call via the new `negativeCacheTTL` option on `ResolverOptions`. Constants: `DEFAULT_DNS_NEGATIVE_CACHE_TTL`.

Transient errors (DNS server failures, network unreachable) propagate as throws and are NOT cached — only verified "no records exist" answers are.
