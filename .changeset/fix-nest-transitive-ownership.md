---
'@openape/nest': patch
---

Nest API spawn now installs the bridge by default — pass `bridge: false` explicitly to opt out. Without it, the agent has no chat-bridge daemon (no chat-DM contact request, no cron-runner), which made it functionally inert in the test that uncovered the issue.
