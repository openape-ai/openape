---
"@openape/proxy": patch
"@openape/apes": patch
---

proxy: drop local audit-log file, keep stderr-only summary

The proxy used to append a JSONL audit record to a local file (default
`~/.local/state/openape/proxy-audit.jsonl`, configurable via
`proxy.audit_log`). Two problems with that:

1. **It can't function as an audit trail.** Anything written on the agent's
   host is also writable by the agent — there's no integrity story we'd be
   willing to put in front of a reviewer. Local files are debugging data, not
   evidence.
2. **It crashed the proxy on first use.** `appendFileSync` raised ENOENT
   because the default state dir didn't exist on a fresh machine, the
   exception bubbled out of `writeAudit`, tore down the in-flight CONNECT, and
   was misreported as `grant_timeout` by the surrounding `try/catch` of
   `handleConnect`.

Both issues go away by removing the file path entirely. The stderr summary
line stays — that's a debugging convenience for the operator running
`apes proxy --` interactively, not an audit. The trustworthy audit record
lives server-side on the IdP, recorded for every grant decision; a per-agent
audit view will be exposed there in a follow-up.

Removed surfaces:

- `proxy.audit_log` config field (TOML) — silently ignored if still present in
  legacy configs; nothing reads it.
- `initAudit()` export from `@openape/proxy` — now no-op semantics, function
  removed.
- `apes proxy --` no longer emits `audit_log = …` into the auto-generated
  TOML.

Drive-by: the stderr summary stopped printing `example.comexample.com:443`
for CONNECT (`domain` and `path` were being concatenated, but CONNECT puts
`host:port` in `path`).
