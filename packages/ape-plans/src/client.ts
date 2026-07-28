/**
 * Shared SP client instance for plans.openape.ai.
 *
 * Single call-site for createSpClient — all command modules and helpers
 * import from here (via the api/config/output shims) rather than reaching
 * into @openape/cli-auth directly.
 */
import { createProofClient } from '@openape/proof-cli'
import type { SpClientState } from '@openape/cli-auth'

export interface PlansState extends SpClientState {
  endpoint?: string
  /** Default team ULID for this endpoint. `teams use <id>` sets it. */
  activeTeamId?: string
}

export const plansClient = createProofClient<PlansState>({
  endpoint: 'https://plans.openape.ai',
  envVar: 'APE_PLANS_ENDPOINT',
  configFile: 'auth-plans.json',
  aud: 'plans.openape.ai',
})

export const {
  resolveEndpoint,
  loadConfig,
  saveConfig,
  _request,
} = plansClient
