/**
 * Shared SP client instance for pr.openape.ai.
 *
 * Single call-site for createSpClient — all command modules import from
 * here rather than reaching into @openape/cli-auth directly. Auth is the
 * unified apes session: `apes login` once per device, this client exchanges
 * the IdP token via POST /api/cli/exchange and caches the SP token.
 */
import { createProofClient } from '@openape/proof-cli'
import type { SpClientState } from '@openape/cli-auth'

export type PrState = SpClientState

export const prClient = createProofClient<PrState>({
  endpoint: 'https://pr.openape.ai',
  envVar: 'APE_PR_ENDPOINT',
  configFile: 'auth-pr.json',
  aud: 'pr.openape.ai',
})

export const {
  configPath,
  resolveEndpoint,
  loadConfig,
  saveConfig,
  apiCall: _apiCall,
  _request,
} = prClient
