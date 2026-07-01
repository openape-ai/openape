/**
 * Tasks-specific config helpers.
 *
 * Generic endpoint resolution + state I/O now live in @openape/cli-auth
 * via createSpClient (see src/client.ts). This file provides the
 * tasks-app-specific helpers (active team selection) that commands import
 * unchanged, plus re-exports the generic helpers under the names the rest
 * of the codebase uses.
 *
 * Migration note: the old ~/.openape/auth-tasks.json state structure stored
 * `activeEndpoint` + nested `endpoints[url].token` — the new structure
 * (written by createSpClient) stores a flat object with `endpoint` +
 * `activeTeamId` at the top level. On the next successful command the
 * new file is written and the old one is superseded. Users can safely delete
 * ~/.openape/auth-tasks.json once they have run `apes login` on this device.
 */
import { resolveEndpoint, loadConfig, saveConfig } from './client.ts'
import type { TasksState } from './client.ts'
import { ApiError } from '@openape/cli-auth'

export { resolveEndpoint } from './client.ts'

/** Per-endpoint active team, set via `teams use <id>`. */
export function getActiveTeamId(endpointOverride?: unknown): string | undefined {
  return (loadConfig() as TasksState).activeTeamId
}

export function setActiveTeamId(teamId: unknown, endpointOverride?: unknown): void {
  const state = loadConfig() as TasksState
  if (typeof teamId === 'string' && teamId.length > 0) state.activeTeamId = teamId
  else delete state.activeTeamId
  saveConfig(state)
}

/**
 * Resolve a team id for a command: explicit `--team` wins, then the stored
 * active team, then throw a clear error pointing the user at `teams use`.
 */
export function resolveTeamId(explicit?: unknown, endpointOverride?: unknown): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const active = getActiveTeamId(endpointOverride)
  if (active) return active
  throw new ApiError(400, 'No team', 'Pass --team <id> or run `ape-tasks teams use <id>` to set a default.')
}
