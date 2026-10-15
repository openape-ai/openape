import type { ServiceScope } from './services'

export type ProgramExecutionRecord =
  | { phase: 'authorized', write: boolean, input: unknown }
  | { phase: 'completed', exitCode: number }
  | { phase: 'not-started' | 'unknown' }

/** Internal desktop/worker supervision only; a script cannot submit execution receipts. */
export interface ProgramExecutionCheck { scope: ServiceScope, operationId: string, record: ProgramExecutionRecord }

/** Identifies a generic assigned program invocation. */
export function isProgramCall(body: unknown): boolean { return !!body && typeof body === 'object' && ('applicationId' in body || 'application' in body) }
