# Agent Pause Feature

Agents can be paused to prevent LLM turns and token consumption while maintaining their WebSocket connection to troop.

## Use Case

Pause agents that are idle but should remain connected. This prevents unnecessary token burn without requiring a full disconnect and reconnection.

## How It Works

The pause feature operates at two scopes:

### Nest-wide Pause

Pauses all agents in the nest. When the nest is paused, no agent will process any turns regardless of individual agent state.

### Per-Agent Pause

Pauses a specific agent while others continue running. The agent stays connected to troop but drops incoming turns without consuming tokens.

## Technical Details

- **Pause State**: Stored in `agents.json` (per-agent) and `nest-state.json` (nest-wide)
- **Enforcement**: Guards in `dispatchTurn()` and `tickAll()` check pause state before any LLM work
- **Persistence**: Pause state survives daemon restarts
- **Zero Tokens**: Paused agents drop turns immediately without calling the LLM
- **Database Mirror**: The `agents.paused` column in troop mirrors the nest registry for fast UI badge display

## Manual Control

To pause or resume agents before CLI/API support lands, you can directly edit the registry files:

### Per-Agent Pause

Edit `agents.json` (typically at `/var/openape/nest/agents.json`):

```json
{
  "version": 1,
  "agents": [
    {
      "name": "my-agent",
      "paused": true,
      "pausedAt": 1781943527000
    }
  ]
}
```

Set `"paused": true` to pause, `"paused": false` (or remove the field) to resume.

### Nest-wide Pause

Edit `nest-state.json` (typically at `/var/openape/nest/nest-state.json`):

```json
{
  "paused": true
}
```

Set `"paused": true` to pause all agents, `"paused": false` to resume.

## Behavior

When an agent is paused:
1. Incoming troop messages are logged but not dispatched to the LLM
2. The agent's WebSocket connection remains active
3. No tokens are consumed
4. The agent can be resumed instantly by clearing the pause flag

When the nest is paused:
1. All agents stop processing turns regardless of individual pause state
2. Individual agent pause flags are preserved
3. Resuming the nest restores normal operation for all non-paused agents

## Testing

The pause feature is covered by `apps/openape-nest/test/pause.test.ts`:
- Agent pause toggle with timestamp
- Nest-wide pause overrides individual agent state
- Dispatch guard drops turns before any LLM work
- Unknown agents return false on pause operations

## CLI Usage

The `ape-troop` CLI provides commands to pause and resume agents and nests:

### Pause/Resume an Agent

```bash
ape-troop agents pause <agent_name> [--host-id <host_id>] [--json]
ape-troop agents resume <agent_name> [--host-id <host_id>] [--json]
```

- `<agent_name>`: The agent's short name (required)
- `--host-id`: Target device host_id (optional; defaults to first connected nest)
- `--json`: Output as JSON instead of human-readable format

### Pause/Resume a Nest

```bash
ape-troop nests pause <host_id> [--json]
ape-troop nests resume <host_id> [--json]
```

- `<host_id>`: The device's host_id (required)
- `--json`: Output as JSON instead of human-readable format

## API Usage

The troop API exposes endpoints for programmatic control:

### Agent Endpoints

- `POST /api/agents/:name/pause` - Pause a specific agent
- `POST /api/agents/:name/resume` - Resume a specific agent

### Nest Endpoints

- `POST /api/nests/:host_id/pause` - Pause all agents in a nest
- `POST /api/nests/:host_id/resume` - Resume all agents in a nest

These endpoints require the `troop:pause-agent` scope.

## Future Work

- **M3**: UI controls in troop for one-click pause/resume (agent detail page with pause badge and button, nest detail with fleet pause/resume action)
