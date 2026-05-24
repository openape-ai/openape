---
"@openape/apes": patch
---

fix(coding): non-interactive GitHub git auth + clarify agent persona

The agent's git defaulted to `credential.helper=osxkeychain`, which hangs
headless (no GUI for the spawned agent user) — so when the LLM ran `git
push` itself the whole run stalled. The clone now configures
`credential.helper` to supply `x-access-token:$GH_TOKEN` (read from the
gated shell's env at push time, never stored) for GitHub remotes, so any
git operation authenticates without a prompt.

Also clarifies the coding-agent recipe persona: the agent EDITS and
VERIFIES only and leaves changes uncommitted; the orchestrator commits,
pushes, and opens the PR (so the policy/merge gate is never bypassed).
The old intent told the agent to "open a pull request" itself.
