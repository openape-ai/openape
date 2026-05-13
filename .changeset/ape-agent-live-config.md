---
"@openape/ape-agent": minor
---

Re-read `agent.json` per turn so live edits in the troop UI take
effect in existing chat threads — not just on freshly-opened ones.
`ThreadSessionDeps` now takes a `resolveConfig` closure instead of
frozen `systemPrompt` + `tools` fields; the closure is called at
the top of every turn. In-memory chat history is preserved so the
ongoing conversation continues seamlessly with the new config.
