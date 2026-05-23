---
"@openape/apes": minor
---

`apes agents code` — the coding-agent trigger entrypoint. Runs one coding task (`--issue <ref> --repo <url> [--forge]`) or polls a label (`--poll-label`), wiring the orchestrator (`runCodingTask`) with the LLM reviewer + risk assessor, the coding toolset (file.*/bash/verify/forge-read — no pr.merge), and per-repo policy resolved from the cloned worktree (`.openape/coding.json` + derived signals). The recipe's cron schedule calls this in `--poll-label` mode. Also: `runCodingTask` now accepts `resolvePolicy(worktree)` to load policy lazily from the clone.
