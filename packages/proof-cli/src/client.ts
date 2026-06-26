import { createSpClient } from '@openape/cli-auth'
import type { SpClient, SpClientState } from '@openape/cli-auth'
import type { ProofCliDescriptor } from './descriptor'

/**
 * Build the shared SP client from a descriptor. Thin mapping over
 * `createSpClient` — the per-app `client.ts` becomes a one-liner that calls
 * this and re-exports the pieces its domain commands already import.
 *
 * `TState` lets an app widen the persisted state (e.g. tasks adds
 * `activeTeamId`) while keeping the generic endpoint/token handling shared.
 */
export function createProofClient<TState extends SpClientState = SpClientState>(
  d: Pick<ProofCliDescriptor, 'endpoint' | 'envVar' | 'aud' | 'configFile'>,
): SpClient<TState> {
  return createSpClient<TState>({
    defaultEndpoint: d.endpoint,
    envVar: d.envVar,
    configFile: d.configFile,
    defaultAud: d.aud,
  })
}
