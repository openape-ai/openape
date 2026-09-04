---
'@openape/openclaw-grant-gate': minor
'@openape/shapes': patch
---

Add `@openape/openclaw-grant-gate`, an OpenClaw plugin that routes every agent `exec` through the DDISA grant flow.

The grant is requested in `before_tool_call`, before exec starts, so waiting for a human is not bounded by the exec tool's timeout — the case that previously turned a 68-second approval into a grant that was approved but never ran. Execution stays with `ape-shell`, which verifies and consumes the grant token, and reuses an already-approved grant instead of asking twice.

Requests are made with the agent's operator identity and approvals with the owner's; the IdP rejects self-approval, so the split is enforced on both sides. Everything uncertain fails closed.

`@openape/shapes` gains a regression test pinning that a leading env assignment does not parse as an `apes` invocation — the parser behaviour that currently prevents `APES_AUTH_FILE=<owner> apes grants approve <id>` from bypassing the shell gate.
