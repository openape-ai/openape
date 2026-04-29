---
"@openape/proxy": patch
---

proxy: audit log auto-creates parent dir, fails soft on disk errors

Two bugs hit any first-time `apes proxy --` invocation on a machine without
`~/.local/state/openape/`:

1. `appendFileSync` raised `ENOENT` because the default audit-log dir didn't
   exist. The exception bubbled up out of `writeAudit` and tore down the
   in-flight CONNECT, so curl saw `Proxy CONNECT aborted` even after a grant
   had been approved.
2. The same `ENOENT` then landed in the surrounding `try/catch` of
   `handleConnect`, which interpreted it as a grant failure and emitted a
   spurious second `[audit] grant_timeout ...` line (and a 504 to the client).

`writeAudit` now `mkdir -p`s the audit-log parent on first write and falls
back to stderr-only on any disk failure (the stderr summary line is the audit
trail of last resort). A connect tunnel must never be aborted by audit-log
plumbing.

Drive-by: the stderr summary used to print `example.comexample.com:443` for
CONNECT because it concatenated `domain` and `path` (CONNECT puts `host:port`
in `path`). It now formats CONNECT and HTTP forward-proxy targets correctly.
