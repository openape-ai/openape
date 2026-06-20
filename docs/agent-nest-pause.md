# Agent and Nest Pause

Pause individual agents or an entire nest to stop autonomous LLM turns while keeping agents enrolled and WebSocket-connected.

## What is Pause?

Pause lets you stop an agent or nest from running autonomous LLM turns (zero tokens) without disconnecting or respawning. When paused:

- The agent stays **enrolled** in the registry
- The WebSocket connection stays **live**
- No LLM turns are dispatched (neither autonomous ticks nor inbound messages)
- Resume is **instant** — no re-auth, no respawn, same session

This replaces stopping the entire nest container to save idle token burn.

## Use Cases

- **Overnight pause**: Stop all agents from burning tokens while sleeping, resume in the morning instantly
- **Per-agent pause**: Pause a specific agent that's not needed right now while others keep running
- **Emergency pause**: Stop all autonomous activity immediately without disrupting connections

## How It Works

Pause is enforced at the turn-dispatch level:

1. **Per-agent pause**: A `paused` flag on the `AgentEntry` in the registry
2. **Per-nest pause**: A single `paused` flag in `nest-state.json`
3. **Guards** check the flag before every turn:
   - `tickAll()`: Skips autonomous ticks for paused agents (or all if nest is paused)
   - `dispatchTurn()`: Drops inbound message turns for paused agents

The guards read the flag live on every turn, so pause/resume takes effect immediately without restarting anything.

## Pause States

| State | Effect |
|-------|--------|
| Agent not paused | Runs autonomous ticks and processes inbound messages normally |
| Agent paused | Skips turns, stays connected, consumes zero tokens |
| Nest paused | All agents skip turns, all stay connected, zero tokens |

A nest-pause overrides individual agent-pause flags.

## Manual Pause (Nest-Local)

You can pause an agent or nest by editing the registry files directly. This is useful for testing or when CLI/UI is not available.

### Pause a Single Agent

Edit `~/agents.json` and set `paused: true` on the agent entry:

```json
{
  "version": 1,
  "agents": [
    {
      "name": "my-agent",
      "uid": 123,
      "home": "/home/my-agent",
      "email": "my-agent@id.openape.ai",
      "paused": true,
      "pausedAt": 1718884800000
    }
  ]
}
```

### Pause the Entire Nest

Create or edit `~/nest-state.json`:

```json
{
  "paused": true
}
```

### Resume

Set `paused: false` (or remove the field) on the agent, or set `paused: false` in `nest-state.json`. The next tick or inbound message will be processed normally.

## Logs

When a pause state changes, the nest logs the transition:

```
session-host: ⏸ nest paused — skipping all turns
session-host: ⏸ paused, skipping turns: agent-a, agent-b
session-host: ▶ resumed — turns running
```

When a turn is dropped because the agent is paused:

```
agent-runtime: ⏸ my-agent paused, dropping turn (no tokens)
```

## Implementation Details

### Source Files

| Component | File |
|-----------|------|
| Agent registry (per-agent flag) | `apps/openape-nest/src/lib/registry.ts` |
| Nest state (fleet pause) | `apps/openape-nest/src/lib/nest-state.ts` |
| Autonomous tick guard | `apps/openape-nest/src/lib/session-host.ts` |
| Inbound message guard | `apps/openape-nest/src/lib/agent-runtime-session.ts` |
| Tests | `apps/openape-nest/test/pause.test.ts` |

### API (M1)

M1 implements nest-local enforcement only. The following are available by manipulating the registry files directly:

- `setAgentPaused(name: string, paused: boolean): boolean` — Set per-agent pause flag
- `setNestPaused(paused: boolean): void` — Set nest-wide pause flag
- `isAgentPaused(name: string): boolean` — Check if an agent should skip turns

### Future (M2/M3)

M2/M3 will add:

- `ape-troop CLI` commands: `ape-troop agents pause <name>`, `ape-troop nest pause`
- Troop API endpoints for remote pause/resume
- Troop UI toggle with status badges

## Testing

To verify pause works:

1. Start the nest with an agent running
2. Observe periodic LLM calls in the logs
3. Set `paused: true` on the agent in `agents.json`
4. Verify no new LLM calls occur within one tick interval
5. Send an inbound message to the agent — verify it's dropped (no LLM call)
6. Set `paused: false` — verify the agent resumes on the next tick without re-auth

Unit tests in `pause.test.ts` verify the predicate logic and that `dispatchTurn` drops turns before any LLM work.

## Backward Compatibility

The `paused` field is optional on `AgentEntry`. Agents without the field run normally (backward-compatible). Default state is "not paused".

## Related

- PR #826: [feat(nest): pause per agent + per nest (M1 enforcement)](https://git.openape.ai/openape-ai/openape/pulls/826)
- Plan: `.claude/plans/2026-06-20-agent-nest-pause.md`
