---
'@openape/apes': minor
---

Stage 1.5/1.6/1.7 of the Nest plan: zero-prompt spawn via Nest-as-DDISA-Agent + YOLO-policy.

- `apes nest enroll`: registers the local nest as its own DDISA-agent (`nest-<host>+<owner>+<dom>@id.openape.ai`), keypair + auth.json under `~/.openape/nest/.config/apes/`. Owner is the human user; uses the existing `registerAgentAtIdp` + `issueAgentToken` flow.

- `apes nest authorize` (rewritten): PUTs a YOLO-policy on the nest-agent's email at `id.openape.ai/api/users/<nest-email>/yolo-policy` with mode=`allow-list` and default allow_patterns covering `apes agents spawn|destroy|sync` plus the bridge-supervisor invocation. Patterns are bash-style globs evaluated against the joined command line, matching the existing yolo_policies semantics.

- `apes nest install`: launchd plist now sets `HOME=~/.openape/nest`, so apes-CLI subprocesses the daemon spawns automatically read the nest's own auth.json — no env-var plumbing needed; the YOLO-policy on the nest-identity gates them at the IdP grant-creation hook.

After enroll + authorize: `POST http://127.0.0.1:9091/agents` runs without DDISA prompts.
