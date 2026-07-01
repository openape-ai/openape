/**
 * Shared SP client instance for timetrack.openape.ai.
 *
 * Single call-site for createSpClient — all command modules and helpers
 * import from here (via the api/config/output shims) rather than reaching
 * into @openape/cli-auth directly.
 *
 * Timetrack-specific: config includes per-endpoint `activeCompanyId` and
 * `activeProjectId` for sticky defaults. Endpoint resolution deliberately
 * does NOT read a stored `activeEndpoint` — a transient dev test against
 * localhost must never sticky-hijack later prod invocations (see plan
 * discovery 2026-05-15). The `resolveEndpoint` in createSpClient reads the
 * env var and stored `endpoint` field; timetrack's config.ts wraps that with
 * its own non-sticky logic.
 */
import { createProofClient } from '@openape/proof-cli'
import type { SpClientState } from '@openape/cli-auth'

export interface TimerackState extends SpClientState {
  endpoint?: string
  /** Default company ULID for this endpoint. `companies use <id>` sets it. */
  activeCompanyId?: string
  /** Default project ULID for this endpoint. `projects use <id>` sets it. */
  activeProjectId?: string
}

export const timerackClient = createProofClient<TimerackState>({
  endpoint: 'https://timetrack.openape.ai',
  envVar: 'APE_TIMETRACK_ENDPOINT',
  configFile: 'auth-timetrack.json',
  aud: 'timetrack.openape.ai',
})

export const {
  resolveEndpoint: _resolveEndpoint,
  loadConfig,
  saveConfig,
  _request,
} = timerackClient
