---
"@openape/ape-agent": minor
---

Prompt-injection detection before forwarding inbound chat to the agent
runtime (#277). The bridge classifies every inbound message via
`@openape/prompt-injection-detector` and refuses to forward (with a
neutral reply) when the score crosses the per-sender threshold —
owners get a higher bar than peers so legitimate instructions aren't
blocked.
