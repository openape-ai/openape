/**
 * Shared SP client instance for testrun.openape.ai.
 *
 * Single call-site for createSpClient — all command modules import from
 * here rather than reaching into @openape/cli-auth directly. Auth is the
 * unified apes session: `apes login` once per device, this client exchanges
 * the IdP token via POST /api/cli/exchange and caches the SP token.
 */
import { createProofClient } from '@openape/proof-cli'
import type { SpClientState } from '@openape/cli-auth'

export type TestrunState = SpClientState

export const testrunClient = createProofClient<TestrunState>({
  endpoint: 'https://testrun.openape.ai',
  envVar: 'APE_TESTRUNS_ENDPOINT',
  configFile: 'auth-testruns.json',
  aud: 'testrun.openape.ai',
})

export const {
  resolveEndpoint,
  _request,
} = testrunClient
