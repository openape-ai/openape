/**
 * Shared SP client instance for tasks.openape.ai.
 *
 * Single call-site for createSpClient — all command modules and helpers
 * import from here (via the api/config/output shims) rather than reaching
 * into @openape/cli-auth directly.
 */
import { createProofClient } from '@openape/proof-cli'
import type { SpClientState } from '@openape/cli-auth'

export interface TasksState extends SpClientState {
  endpoint?: string
  /** Default team ULID for this endpoint. `teams use <id>` sets it. */
  activeTeamId?: string
}

export const tasksClient = createProofClient<TasksState>({
  endpoint: 'https://tasks.openape.ai',
  envVar: 'APE_TASKS_ENDPOINT',
  configFile: 'auth-tasks.json',
  aud: 'tasks.openape.ai',
})

export const {
  configPath,
  resolveEndpoint,
  loadConfig,
  saveConfig,
  apiCall: _apiCall,
  _request,
} = tasksClient
