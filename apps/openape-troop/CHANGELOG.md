# @openape/troop

## 0.1.1

### Patch Changes

- [#391](https://github.com/openape-ai/openape/pull/391) [`761fd6c`](https://github.com/openape-ai/openape/commit/761fd6c90861f7e6193a28f143f3ad9c97c2871e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add per-agent tool picker to the agent detail page (`/agents/[name]`). Shows all available tools from `tool-catalog.json` with risk badges + descriptions; checkbox per tool; saves via `PATCH /api/agents/[name] { tools: [...] }`. The chat-bridge re-reads the list on every new chat thread, so changes propagate within the next sync (~5min) without a bridge restart.
