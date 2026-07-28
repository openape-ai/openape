---
'@openape/shapes': minor
---

Honour `APES_AUTH_FILE` when resolving the caller identity (#1066)

The adapter-backed grant path (`createShapesGrant`) resolves its identity
through this package, not through `@openape/apes`. Without the override a
wrapper running under an alternate identity — the worker's per-company
operator — silently fell back to the logged-in human's `auth.json`, so
adapter-backed commands (`uname`, `echo`, anything with a shapes adapter)
created grants with the wrong requester and were judged against the wrong
YOLO policy. Non-adapter commands were unaffected: they take the generic
session-grant path inside `@openape/apes`, which already honoured it.
