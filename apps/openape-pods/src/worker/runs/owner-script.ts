import type { OpenApeOwnerScriptAuthority } from '@openape/core'
import type { RunInput } from '../../contracts/runs'
import type { ExecutionObserver } from '../../main/programs/execution'
import type { RunStore } from './store'

export function ownerScriptAuthority(input: RunInput, activationId = `${input.podId}:${input.scriptHash}:${input.assignmentRevision}:${input.resourceEpoch}`): OpenApeOwnerScriptAuthority {
  return { source: 'owner-activation', activationId, podId: input.podId, scriptHash: input.scriptHash, assignmentRevision: input.assignmentRevision, resourceEpoch: input.resourceEpoch }
}

export async function executeOwnerScript<T>(runs: RunStore, runId: string, authority: OpenApeOwnerScriptAuthority, execute: (observer: ExecutionObserver) => Promise<T>): Promise<T> {
  const boundary = `owner-script:${runId}`
  let dispatched = false
  const settle = (state: 'completed' | 'not-started') => {
    if (!dispatched) return
    runs.assertLease(runId)
    runs.append(runId, 'recovery-boundary-result', { id: boundary, operation: 'owner-script', state })
    dispatched = false
  }
  return execute({
    authorized: async (value) => {
      const receipt = value.authority
      if (receipt?.source !== 'owner-activation' || Object.entries(authority).some(([key, expected]) => receipt[key as keyof OpenApeOwnerScriptAuthority] !== expected)) throw new Error('Root execution authority changed')
      runs.store.transaction(() => {
        runs.assertLease(runId)
        runs.append(runId, 'recovery-boundary', { id: boundary, kind: 'untracked', operation: 'owner-script', authority })
        runs.append(runId, 'root-script', { state: 'authorized', authority })
        dispatched = true
      })
    },
    notStarted: async () => { runs.store.transaction(() => settle('not-started')) },
    completed: async ({ exitCode }) => {
      if (!dispatched) throw new Error('Root completion has no recorded start')
      runs.store.transaction(() => {
        runs.assertLease(runId)
        runs.append(runId, 'root-script', { state: 'completed', authority, exitCode })
        settle('completed')
      })
    },
  })
}
