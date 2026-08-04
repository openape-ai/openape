/**
 * Shared SP client for troop.openape.ai — the calls live in the attention
 * event log there. Auth is the unified apes session: `apes login` once per
 * device, this client exchanges the IdP token for a troop-scoped one.
 */
import { createProofClient } from '@openape/proof-cli'
import type { SpClientState } from '@openape/cli-auth'

export type CallsState = SpClientState

export const callsClient = createProofClient<CallsState>({
  endpoint: 'https://troop.openape.ai',
  envVar: 'OPENAPE_TROOP_URL',
  configFile: 'auth-calls.json',
  aud: 'troop.openape.ai',
})

export const { resolveEndpoint, _request } = callsClient
