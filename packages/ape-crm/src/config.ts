import type { CrmState } from './client.ts'
import { ApiError } from '@openape/cli-auth'
import { loadConfig, saveConfig } from './client.ts'

/**
 * Alle Datenbefehle brauchen einen Workspace. Damit niemand ihn bei jedem
 * Aufruf tippt, merkt sich die CLI einen Default — gesetzt per
 * `ape-crm workspaces use <id>`, überschreibbar per `--workspace`.
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
