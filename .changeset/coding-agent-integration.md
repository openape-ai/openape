---
"@openape/apes": minor
---

Coding-agent integration layer (INT-1/INT-2): `coding/coding-loop.ts` orchestrator ties M1–M7 into one run (issue → worktree → LLM coding loop → verify → PR → policy-gated merge). The LLM does the coding (file.edit/bash/verify, NOT pr.merge); the orchestrator owns branch/worktree/PR/merge-gate and arms `--auto` (merge-when-green) only after the risk + reviewer gates pass. `coding/llm-review.ts` provides LLM-backed `RiskAssessorFn` + `ReviewerFn` (fail-safe: unsure → risky/blocked). All I/O injected → unit-tested without a live LLM or git. Plus a `coding-agent` example recipe (`examples/agent-recipes/coding-agent/`).
