---
"@openape/apes": patch
---

apes: `apes proxy --` no longer prints a misleading stack trace when the wrapped command exits non-zero

Previously, after a wrapped command failed (e.g. `curl: (56) CONNECT tunnel
failed, response 403` on a denied grant), `apes proxy` printed a bare
"ERROR" header followed by an internal stack trace ending in citty's
`runMain` — even though the proxy itself worked correctly (it denied the
request as policy required) and the wrapped command's exit code was the
real signal.

Cause: `proxy.ts` did `throw new CliExit(exitCode)` to propagate the wrapped
exit code, intending the top-level handler in `cli.ts` to translate it into
`process.exit(exitCode)`. But citty's `runMain` has its own try/catch that
calls `consola.error(error, "\n")` before our handler ever runs. Combined
with `CliExit`'s empty message, that surfaces as `ERROR\n  at Object.run …`.

Fix: skip the CliExit hop and call `process.exit(exitCode)` directly from
`proxy.ts` once cleanup has finished. The user sees only the wrapped
command's stderr and gets the wrapped command's exit code — same outcome,
no spurious "ERROR" framing on a working deny path.
