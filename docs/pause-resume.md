# Pause and Resume Agents and Nests

Control agent activity without disconnecting them. Paused agents stay enrolled and connected but consume zero tokens.

## Overview

OpenAPE provides CLI commands to pause and resume:
- **Individual agents** — granular control per agent
- **Entire nests (devices)** — fleet-wide kill-switch

Paused agents:
- Remain enrolled and WebSocket-connected
- Run no LLM turns (zero token consumption)
- Resume instantly without respawn or re-authentication

## Commands

### Pause/Resume an Agent

Pause a specific agent:

```bash
ape-troop agents pause <agent-name> [--host-id <host_id>]
```

Resume a paused agent:

```bash
ape-troop agents resume <agent-name> [--host-id <host_id>]
```

**Options:**
- `<agent-name>` — The agent's short name (required)
- `--host-id` — Target device host_id. Defaults to the first connected nest if omitted.

**Output:**
- `--json` flag outputs the result as JSON

**Example:**

```bash
# Pause an agent
$ ape-troop agents pause assistant
✓ Paused assistant on mbp-home

# Resume with JSON output
$ ape-troop agents resume assistant --json
{
  "agent_name": "assistant",
  "hostname": "mbp-home",
  "host_id": "abc123...",
  "paused": false
}
```

### Pause/Resume a Nest (Device)

Pause all agents on a device:

```bash
ape-troop nests pause <host_id>
```

Resume a paused device:

```bash
ape-troop nests resume <host_id>
```

**Options:**
- `<host_id>` — The device's host_id (required)
- `--json` flag outputs the result as JSON

**Example:**

```bash
# Pause all agents on a device
$ ape-troop nests pause abc123...
✓ Paused all agents on mbp-home

# Resume the device
$ ape-troop nests resume abc123...
✓ Resumed mbp-home
```

## Use Cases

### Save Tokens Overnight
Pause non-essential agents during off-hours to reduce token consumption while keeping them connected.

### Fleet Kill-Switch
Pause an entire device instantly without disconnecting agents. Useful for:
- Emergency stop during unexpected behavior
- Maintenance windows
- Cost control across multiple agents

### Granular Control
Pause specific agents while keeping others active on the same device.

## API Endpoints

The CLI commands map to these troop API endpoints:

| Action | Endpoint | Scope |
|--------|----------|-------|
| Pause agent | `POST /api/agents/:name/pause` | `troop:pause-agent` |
| Resume agent | `POST /api/agents/:name/resume` | `troop:pause-agent` |
| Pause nest | `POST /api/nests/:host_id/pause` | `troop:pause-agent` |
| Resume nest | `POST /api/nests/:host_id/resume` | `troop:pause-agent` |

## Implementation Details

- **Per-agent pause**: Stored in the agent registry (`AgentEntry.paused`, `AgentEntry.pausedAt`)
- **Nest-wide pause**: Stored in nest state (`NestState.paused`)
- **Guard logic**: Every LLM turn checks the pause state before execution
- **No lifecycle changes**: Paused agents stay connected; ticks continue but LLM turns are skipped

## Related

- [Agent Catalog](./agent-catalog.md) — Overview of all personas
- [ape-troop CLI](../packages/ape-troop/README.md) — Full CLI reference
