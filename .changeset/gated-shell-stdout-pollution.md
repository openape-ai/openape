---
"@openape/apes": patch
---

fix(run): keep apes diagnostics off a wrapped command's stdout for agents

When an agent runs a gated command (`ape-shell -c …` → `apes run -- …`),
it captures the process's stdout as the command result. But apes emitted
its own diagnostics (grant requests, adapter installs, "Fetching grant
token") to stdout via consola/console.log, so a structured command like
`gh issue list --jq '.[].number'` came back as
`ℹ Requesting grant…\n473` — and the coding agent's poll parsed the
banner line as an issue id ("id must be a number"). In agent mode, apes
now routes its JS-level stdout to stderr for the duration of a wrapped
run; the command's own output (fd 1, `stdio:'inherit'`) is untouched, and
the grant-token branch still writes its token to real stdout. Human mode
is unchanged.
