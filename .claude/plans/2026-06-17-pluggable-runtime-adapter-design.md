# Pluggable Runtime Adapter — Design Spec

**Status:** approved (Patrick, 2026-06-17) — ready for implementation plan.
**Scope:** Part 1 of 3. Independent follow-ups (own specs): Part 2 OpenApe-MCP-Server, Part 3 Remote-Nest-Federation. This spec covers **only** the adapter + first foreign runtime (openclaw), CLI-as-tool.

## Goal

Let the nest run a **third-party agent runtime** (first target: **openclaw**) under our DDISA
identity, talking to our LLM gateway, acting on our control-plane via our CLIs — without
building our own agent loop for it. Our own bridge (`@openape/ape-agent`) becomes just one
runtime type behind the same adapter contract, with no special status.

## Why (strategic frame)

Our moat is **identity (DDISA) + deployment (nest) + control-plane**, not the agent loop.
The loop is commoditized (openclaw/codex/claude-cli/…). openclaw is itself a pluggable-runtime
gateway (PI/codex/claude-cli backends, MCP bridge, skills, channels). Role split:

- **We own:** identity, per-agent home, spawn/lifecycle, control-plane, LLM gateway.
- **openclaw owns:** the loop, its backends, tool execution, its channels.

Integration is small because openclaw is config-/file-driven and our CLIs already carry identity.

## Decisions (locked)

| Question | Decision |
|---|---|
| Own bridge vs foreign runtimes | **Bridge becomes an adapter** — sibling of openclaw under one contract, no special case. |
| First foreign runtime | **openclaw** (docs.openclaw.ai) — design the contract against its real interface. |
| Tool access in MVP | **CLI-as-tool** — openclaw gets shell + `apes`/`ape-tasks`/`ape-troop`. MCP server (Part 2) only when this measurably falls short. |

## openclaw interface (verified from docs.openclaw.ai)

- **Config** (`~/.openclaw/config.json5`): `agents.list[]` with `id`, `model`, `workspace`, `identity{name,emoji,…}`.
- **Persona/SOUL:** workspace bootstrap files `SOUL.md` / `AGENTS.md` / `IDENTITY.md` / `USER.md`.
  `agents.defaults.skipBootstrap` / `skipOptionalBootstrapFiles` to control auto-creation.
- **Model ref:** `provider/model`, e.g. `"openape/gpt-5.5"`.
- **OpenAI-compatible provider:** `models.providers.<name> = { baseUrl, apiKey, models:[…] }`;
  apiKey falls back to env (`OPENAI_API_KEY`).
- **Runtime backend:** `agents.*.models["…"].agentRuntime.id` ∈ `auto|openclaw|codex|claude-cli`.
  Default `openclaw` (its internal PI harness) — we use the default; **we** are the substrate, not its backend chooser.
- **Reasoning:** `reasoningDefault` (off|stream|…), `thinkingDefault` (off…max).
- **Tools/skills:** `tools.allow/deny`, `skills:[…]`.

## The contract

```ts
// New: a runtime adapter abstracts only the runtime-specific part.
// The nest already provides everything else (identity, home, pm2/sudo spawn, TroopSync).
interface RuntimeAdapter {
  id: string                                  // "bridge" | "openclaw"
  prepare(ctx: AgentContext): Promise<void>   // herrich the home (configs + workspace), idempotent
  launchSpec(ctx: AgentContext): LaunchSpec   // what pm2 runs
}

interface LaunchSpec {
  script: string                  // node entrypoint OR interpreter target
  interpreter?: string            // e.g. undefined for node, "none" for a binary
  args?: string[]
  env: Record<string, string>     // merged into ecosystem env
  cwd: string                     // the agent home
}

// What the nest GUARANTEES to every adapter (the contract's other half):
interface AgentContext {
  home: string                    // per-agent home; has .config/apes/auth.json, .pm2
  email: string                   // <name>-<nest>+<owner>@id.openape.ai
  name: string
  nest: string
  owner: string
  recipe: AgentRecipe             // persona/system-prompt, tools, cron, params
  model: string                   // e.g. "gpt-5.5"
  reasoning?: string              // from spawn flag; may be undefined
  gatewayBaseUrl: string          // "https://llms.openape.ai/v1"
  // how a runtime gets a fresh DDISA gateway token (file path it can re-read,
  // or a command it can run). MVP: env from auth.json at (re)start.
  tokenRef: { kind: 'env' | 'file' | 'cli'; value: string }
}
```

`AgentContext` is assembled by the nest from the existing `AgentEntry` + recipe + spawn flags.
`RuntimeAdapter.id` is selected by the agent's new `runtime_type` field (default `"bridge"`).

## Components & files

### New
- `apps/openape-nest/src/lib/adapters/types.ts` — `RuntimeAdapter`, `LaunchSpec`, `AgentContext`.
- `apps/openape-nest/src/lib/adapters/bridge-adapter.ts` — wraps today's behavior (reference impl).
- `apps/openape-nest/src/lib/adapters/openclaw-adapter.ts` — writes openclaw config + workspace, returns launch spec.
- `apps/openape-nest/src/lib/adapters/index.ts` — registry `{ bridge, openclaw }`, `adapterFor(agent)`.

### Modified
- `apps/openape-nest/src/lib/pm2-supervisor.ts` — `ecosystemContents(agent)` currently hardcodes
  `script: <bridge.mjs>` + `ecosystemEnvLines`. Change: derive `script`/`args`/`env`/`cwd` from
  `adapterFor(agent).launchSpec(ctx)`; call `adapter.prepare(ctx)` before materializing the ecosystem.
- Agent record (`AgentEntry`) + nest store + troop schema — add `runtime_type` (nullable, default `bridge`).
- `packages/ape-troop/src/commands/agents.ts` (and/or `packages/apes/.../agents`) — `spawn --type <id>`
  persists `runtime_type`. `apes agents list` shows the type.
- Recipe → openclaw mapping lives in `openclaw-adapter.ts` (persona→SOUL.md, instructions→AGENTS.md).

### openclaw-adapter.prepare(ctx) writes into `ctx.home`
1. `~/.openclaw/config.json5`:
   - provider `openape`: `{ baseUrl: ctx.gatewayBaseUrl, apiKey: "env:OPENAI_API_KEY", models: ["gpt-5.5","gpt-5.4",…] }`
   - `agents.list[0] = { id: ctx.name, model: "openape/"+ctx.model, workspace: <home>/workspace, identity:{name}, reasoningDefault:"off" }`
   - `tools.allow` includes `exec`/shell (so it can run our CLIs).
2. `workspace/SOUL.md` ← recipe persona; `workspace/AGENTS.md` ← operating instructions incl.
   "Your tools are the `apes`, `ape-tasks`, `ape-troop` CLIs. You are agent `<email>`."; `workspace/IDENTITY.md` ← name/role.
3. Idempotent: re-run overwrites generated files (they are mechanically derived from the recipe).

### openclaw-adapter.launchSpec(ctx)
```
{ script: "openclaw", interpreter: "none", args: ["run","--agent",ctx.name],
  cwd: ctx.home, env: { HOME: ctx.home, OPENAI_API_KEY: <fresh token from auth.json> } }
```
Pinned openclaw version is a deploy prerequisite (see sharp edges).

### bridge-adapter (refactor, no behavior change)
`prepare` = today's config write (`resolveBridgeConfig`), `launchSpec` = `{ script: <bridge.mjs>, env: ecosystemEnvLines(agent)-equivalent, cwd: home }`. Pure move behind the interface; default fleet must remain byte-identical in behavior.

## MVP acceptance (the proof)

On a nest:
```
apes agents spawn --type openclaw --name test-ceo --model gpt-5.5 --recipe <ceo>
```
1. openclaw process is up under the agent home (pm2 shows it).
2. It answers a prompt **via llms.openape.ai** — gateway access log shows `200` for `gpt-5.5`
   carrying *this agent's* DDISA token (not master_key).
3. It runs `ape-tasks new …` (or `ape-troop`) as a tool and the action lands under the agent
   identity — e.g. a task created with the correct `owner`/`assignee`.
4. Existing `--type bridge` agents (default) are unchanged.

## Sharp edges (explicit, not hidden)

1. **Token expiry on long sessions** — same class as the bridge `ThreadSession` 401 fix
   (commit `b4b02f3a`). openclaw reads the key at start; a multi-hour session sends a stale
   token. MVP: short sessions / restart re-mints. Durable: a `tokenRef.kind:'file'` openclaw
   re-reads, or a wrapper that re-mints before launch. Documented as known limitation.
2. **`reasoning_effort`+`tools` → 404 on our gateway** (filed task `01KVANKACC6NYHK4VCW09DXYVR`).
   MVP workaround is free: `reasoningDefault:"off"` in the openclaw config. Durable = that task.
3. **openclaw availability/version on the nest** — must be installed and version-pinned; the
   adapter assumes a known CLI surface (`openclaw run --agent …`). Verify exact run syntax
   against the pinned version before coding `launchSpec`.
4. **Two substrates overlap** — openclaw has its own channels/skills/multi-agent. MVP uses
   **one openclaw process per one of our agents** and ignores openclaw's channels.

## Deliberately out of scope (YAGNI)

- Cron for openclaw agents (prove interactive first; our cron-runner can drive it later).
- DM/owner reporting for openclaw (bridge-specific).
- openclaw channels / its own multi-agent orchestration.
- OpenApe-MCP-Server (Part 2) — only when CLI-as-tool falls short.
- Remote-nest federation, `apes agents run --as` to remote nests (Part 3).
- More runtimes (hermes/pi/claude-cli) — contract is validated against bridge + openclaw; add later.

## Open verification before plan — RESOLVED by spike (2026-06-17)

See `openclaw-spike-findings.md`. openclaw `2026.6.8`:
- **Run model:** one-shot embedded — `openclaw agent --local --json --message … --session-key agent:<id>:<key>`.
  **No daemon needed.** ⇒ contract becomes a `daemon | oneshot` union; openclaw is `oneshot`,
  bridge stays `daemon`. Only daemon adapters touch `pm2-supervisor`; oneshot hooks the chat router.
- **Per-instance isolation:** env `OPENCLAW_CONFIG_PATH` + `OPENCLAW_STATE_DIR` (+ `HOME`) — our pm2-env pattern.
- **Config writes:** `openclaw config patch --stdin` (schema-validated) instead of hand-templating JSON5.
- **Provider key on every call:** high confidence (standard OpenAI-compatible provider, apiKey via
  `OPENAI_API_KEY`); packet-confirm at E2E (Task 5).
- Token expiry (sharp edge #1) is *softer* in one-shot: re-read `auth.json` per `invoke`.
