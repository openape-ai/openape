import { NonRetryableError } from '../../contracts/infrastructure'
import type { ProgramExecutionRecord } from '../../contracts/program-execution'
import type { ExecutionObserver } from './execution'

/** ape-shell supplies authority; this bridge acknowledges only after the worker durably records a write intent. */
export async function executeRecordedProgram<T extends { exitCode: number }>(input: unknown, execute: (observer: ExecutionObserver) => Promise<T>, record: (value: ProgramExecutionRecord) => Promise<void>, pending?: ExecutionObserver['pending']): Promise<T> {
  let intent = false
  const observer: ExecutionObserver = {
    pending,
    authorized: async ({ write }) => {
      await record({ phase: 'authorized', write, input })
      intent = write
    },
    notStarted: async () => {
      if (intent) { await record({ phase: 'not-started' }); intent = false }
    },
  }
  try {
    const result = await execute(observer)
    if (intent) { await record({ phase: 'completed', exitCode: result.exitCode }); intent = false }
    return result
  }
  catch (error) {
    if (!intent) throw error
    try { await record({ phase: 'unknown' }) }
    catch { throw new NonRetryableError('Program outcome could not be settled; the durable intent requires reconciliation') }
    throw new NonRetryableError(error instanceof Error ? error.message : 'Program outcome is unknown; reconcile before retrying')
  }
}
