---
'@openape/nest': patch
'@openape/apes': patch
---

Fix nest bridge supervisor — three bugs that conspired to flood the human with approval prompts on every supervisor restart:

1. **Wrong YOLO pattern**: The default nest YOLO allow-pattern was `apes run --as * -- openape-chat-bridge`, but escapes-helper unwraps the `apes run --as <agent> --` prefix before submitting the grant request to the IdP. So the actual target string the YOLO evaluator saw was just `openape-chat-bridge`. The pattern is now `openape-chat-bridge` (just the inner command) — `apes nest authorize` re-runs apply the corrected default.

2. **Missing `--wait`**: The supervisor invoked `apes run --as <agent> -- openape-chat-bridge` without `--wait`. Even when YOLO auto-approved the grant server-side, the CLI returned exit 75 (EX_TEMPFAIL) the moment the grant was created — before the CLI observed the approval. Added `--wait` to mirror the spawn-handler.

3. **Doubly-nested registry path**: `agents.json` was written to `~/.openape/nest/.openape/nest/agents.json` because `homedir()` already returned `~/.openape/nest` (the launchd-set daemon HOME) and the registry then joined `.openape/nest/` again on top. Registry now lives directly at `$HOME/agents.json`. Existing installs need a one-time `mv ~/.openape/nest/.openape/nest/agents.json ~/.openape/nest/agents.json`.
