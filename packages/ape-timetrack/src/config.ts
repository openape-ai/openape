/**
 * Timetrack-specific config helpers.
 *
 * Generic endpoint resolution + state I/O now live in @openape/cli-auth
 * via createSpClient (see src/client.ts). This file provides the
 * timetrack-app-specific helpers (active company / project selection) that
 * commands import unchanged, plus re-exports the generic helpers under the
 * names the rest of the codebase uses.
 *
 * Intentional behavioral difference from ape-tasks / ape-plans:
 * `resolveEndpoint` does NOT read a persisted `activeEndpoint`. Endpoint
 * resolution order is: explicit `--endpoint` arg → APE_TIMETRACK_ENDPOINT env
 * → DEFAULT_ENDPOINT (prod). A transient dev test against localhost must never
 * sticky-hijack later prod invocations (see plan discovery 2026-05-15).
 *
 * Migration note: the old ~/.openape/auth-timetrack.json state stored
 * `activeEndpoint` + nested `endpoints[url].{activeCompanyId,activeProjectId}`
 * — the new structure (written by createSpClient) stores a flat object with
 * `activeCompanyId` / `activeProjectId` at the top level. On the next
 * successful command the new file is written and the old one is superseded.
 * Users can safely delete ~/.openape/auth-timetrack.json once they have run
 * `apes login` on this device.
 */
import { _resolveEndpoint, loadConfig, saveConfig } from './client.ts'
import type { TimerackState } from './client.ts'
import { ApiError } from '@openape/cli-auth'

const DEFAULT_ENDPOINT = process.env.APE_TIMETRACK_ENDPOINT ?? 'https://timetrack.openape.ai'

/**
 * Endpoint resolution: explicit `--endpoint` arg → APE_TIMETRACK_ENDPOINT env
 * → DEFAULT_ENDPOINT (prod). Deliberately does NOT read a persisted
 * activeEndpoint to avoid transient dev sessions hijacking prod invocations.
 */
export function resolveEndpoint(override?: unknown): string {
  if (typeof override === 'string' && override.length > 0) return override.replace(/\/$/, '')
  return DEFAULT_ENDPOINT.replace(/\/$/, '')
}

function currentState(): TimerackState {
  return loadConfig() as TimerackState
}

// ---------------------------------------------------------------------------
// Company helpers
// ---------------------------------------------------------------------------

export function setActiveCompanyId(companyId: unknown, _endpointOverride?: unknown): void {
  const state = currentState()
  if (typeof companyId === 'string' && companyId.length > 0) state.activeCompanyId = companyId
  else delete state.activeCompanyId
  saveConfig(state)
}

export function resolveCompanyId(explicit?: unknown, _endpointOverride?: unknown): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const active = currentState().activeCompanyId
  if (active) return active
  throw new ApiError(400, 'No company', 'Pass --company <id> or run `ape-timetrack companies use <id>` to set a default.')
}

// ---------------------------------------------------------------------------
// Project helpers
// ---------------------------------------------------------------------------

export function setActiveProjectId(projectId: unknown, _endpointOverride?: unknown): void {
  const state = currentState()
  if (typeof projectId === 'string' && projectId.length > 0) state.activeProjectId = projectId
  else delete state.activeProjectId
  saveConfig(state)
}

export function resolveProjectId(explicit?: unknown, _endpointOverride?: unknown): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const active = currentState().activeProjectId
  if (active) return active
  throw new ApiError(400, 'No project', 'Pass --project <id> or run `ape-timetrack projects use <id>` to set a default.')
}
