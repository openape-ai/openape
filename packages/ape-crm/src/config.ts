import type { CrmState } from './client.ts'
import { ApiError } from '@openape/cli-auth'
import { loadConfig, saveConfig } from './client.ts'

/**
 * Every data command needs a workspace. So nobody has to type it on each
 * call, the CLI remembers a default — set via `ape-crm workspaces use <id>`,
 * overridable with `--workspace`.
 */
export function setActiveWorkspaceId(workspaceId: unknown): void {
  const state = loadConfig() as CrmState
  if (typeof workspaceId === 'string' && workspaceId.length > 0) state.activeWorkspaceId = workspaceId
  else delete state.activeWorkspaceId
  saveConfig(state)
}

export function resolveWorkspaceId(explicit?: unknown): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const active = (loadConfig() as CrmState).activeWorkspaceId
  if (active) return active
  throw new ApiError(
    400,
    'No workspace',
    'Pass --workspace <id> or run `ape-crm workspaces use <id>` to set a default.',
  )
}
