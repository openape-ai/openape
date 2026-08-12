/**
 * Shared SP client instance for dashboard.openape.ai.
 *
 * Single call-site for createProofClient — commands import the request
 * helper from here rather than reaching into @openape/cli-auth directly.
 * Auth: the unified apes session (`apes login` once per device); tokens are
 * exchanged against ${endpoint}/api/cli/exchange and cached.
 */
import { createProofClient } from '@openape/proof-cli'
import type { SpClientState } from '@openape/cli-auth'

export type KpiState = SpClientState

export const kpiClient = createProofClient<KpiState>({
  endpoint: 'https://dashboard.openape.ai',
  envVar: 'APE_KPI_ENDPOINT',
  configFile: 'auth-kpi.json',
  aud: 'dashboard.openape.ai',
})

export const { _request } = kpiClient
