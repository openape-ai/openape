---
"@openape/agent-runtime": minor
"@openape/apes": minor
---

Extract the agent-execution cluster (in-process run loop, agent tools, coding agent) from `@openape/apes` into a new dependency-light `@openape/agent-runtime` package. apes re-exports the surface, so `@openape/ape-agent` is unaffected. No behaviour change.
