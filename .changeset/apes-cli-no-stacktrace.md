---
"@openape/apes": patch
---

fix(cli): no stack trace on controlled exits (pending grant, usage errors)

citty's `runMain` dumped every thrown error (CliExit/CliError) with an internal
stack trace and forced exit 1, so a pending-grant `apes run` (exit 75) and
usage mistakes surfaced as misleading crashes. Real commands now dispatch via
`runCommand`, which re-throws so our handler renders the message cleanly and
honours the intended exit code; builtin help/version/usage stay on `runMain`.
