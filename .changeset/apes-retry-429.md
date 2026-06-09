---
"@openape/apes": patch
---

`apiFetch` now retries on HTTP 429 (the IdP's per-IP rate limit on auth
endpoints), honouring `Retry-After` with bounded backoff (≤3 retries, ≤12s
each). Rapid IdP-call sequences — e.g. a nest's `agents spawn` (enroll +
challenge + authenticate) immediately followed by `agents destroy`
(de-register) — bunch on one IP and used to 429 the last call; they now ride
it out. Well-behaved backoff, not a bypass.
