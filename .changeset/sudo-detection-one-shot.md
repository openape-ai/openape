---
'@openape/apes': patch
---

Fix the `sudo` guardrail regression in the `ape-shell -c "<cmd>"` one-shot
path. 0.11.0 added the detection only to the interactive REPL
(`shell/grant-dispatch.ts`), but agents using openclaw's `bash-tools.exec`
with `SHELL=ape-shell` take the one-shot path through `runShellMode` in
`commands/run.ts` — which fell through to the generic session-grant flow
and surfaced an opaque "sudo: a password is required" error with no
guidance.

`checkSudoRejection` is now a shared helper in `shell/apes-self-dispatch.ts`
used by both paths. `ape-shell -c "sudo chown root:wheel /tmp/x"` now
throws a `CliError` with the same migration hint the REPL produces:

> sudo is not available in ape-shell. Use `apes run --as root -- chown root:wheel /tmp/x` for privileged commands.

Compound lines (e.g. `echo x | sudo tee ...`) still fall through to the
generic session-grant path in both dispatch paths.
