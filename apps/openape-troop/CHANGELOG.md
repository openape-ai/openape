# @openape/troop

## 0.1.10

### Patch Changes

- Updated dependencies [2b3814b]
  - @openape/auth@0.12.0
  - @openape/nuxt-auth-sp@0.12.1

## 0.1.9

### Patch Changes

- 41c146a: `POST /api/agents/:name/recipe` now persists `recipe_ref`. Re-pointing a
  deployed agent at a new recipe ref previously updated only the system prompt
  and toolset, leaving the agent's checked-out `tools/` stuck on the old ref;
  the iterate-on-deployed-agent path now actually moves the agent to the new
  version.
- Updated dependencies [7fa0267]
- Updated dependencies [5fa8c23]
- Updated dependencies [e4ce3de]
  - @openape/auth@0.11.3
  - @openape/nuxt-auth-sp@0.12.0

## 0.1.8

### Patch Changes

- Updated dependencies [3e3dfea]
  - @openape/core@0.18.0
  - @openape/nuxt-auth-sp@0.11.3
  - @openape/auth@0.11.2

## 0.1.7

### Patch Changes

- Updated dependencies [04bdf06]
  - @openape/core@0.17.1
  - @openape/nuxt-auth-sp@0.11.2
  - @openape/auth@0.11.1

## 0.1.6

### Patch Changes

- Updated dependencies [a112d23]
  - @openape/nuxt-auth-sp@0.11.1

## 0.1.5

### Patch Changes

- Updated dependencies [2ea39ac]
  - @openape/nuxt-auth-sp@0.11.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`1ce5fd6`](https://github.com/openape-ai/openape/commit/1ce5fd68d147967fbf5c30afed84d2f241bcfbab)]:
  - @openape/auth@0.11.0
  - @openape/nuxt-auth-sp@0.10.2

## 0.1.3

### Patch Changes

- [#431](https://github.com/openape-ai/openape/pull/431) [`eaac874`](https://github.com/openape-ai/openape/commit/eaac8744841cbe54a934a42007ea6722e9f4a537) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - troop: group agents by nest (host) on the `/agents` overview. Each nest gets a hostname header with agent count; agents within a nest stay createdAt-desc, and nests sort by most-recent activity. Freshly-spawned agents whose first sync hasn't filled in the host identity yet live under a "Pending first sync" group at the bottom.

- Updated dependencies [[`33f3e99`](https://github.com/openape-ai/openape/commit/33f3e99ddb408d24ae15e1b220d342f961ec8090)]:
  - @openape/core@0.17.0
  - @openape/nuxt-auth-sp@0.10.1
  - @openape/auth@0.10.2

## 0.1.2

### Patch Changes

- Updated dependencies [[`3aecb77`](https://github.com/openape-ai/openape/commit/3aecb770b87ddda5399d5d91da88480b900dd072)]:
  - @openape/nuxt-auth-sp@0.10.0

## 0.1.1

### Patch Changes

- [#391](https://github.com/openape-ai/openape/pull/391) [`761fd6c`](https://github.com/openape-ai/openape/commit/761fd6c90861f7e6193a28f143f3ad9c97c2871e) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add per-agent tool picker to the agent detail page (`/agents/[name]`). Shows all available tools from `tool-catalog.json` with risk badges + descriptions; checkbox per tool; saves via `PATCH /api/agents/[name] { tools: [...] }`. The chat-bridge re-reads the list on every new chat thread, so changes propagate within the next sync (~5min) without a bridge restart.
