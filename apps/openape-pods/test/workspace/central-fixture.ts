import type { CentralClient, CentralPod, CentralRuntime } from '../../src/contracts/central'

export const podId = '00000000-0000-4000-8000-000000000137'
export const runtimeId = '00000000-0000-4000-8000-000000000138'
export function centralFixture() {
  const pod = { id: podId, name: 'Release monitor', revision: 1, lifecycle: 'active' as const, activeScript: null, online: true }
  const view: CentralPod = {
    id: podId, ready: true,
    details: { description: { text: 'Reviews recent releases and records the results.', revision: 1, state: 'ready', error: null, updatedAt: 1 }, claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 4, versions: [], source: null },
    scripts: { pod, resourceEpoch: 0, credentialAliases: [], versions: [], drafts: [], source: null },
    resources: { resources: [], variables: [], epoch: 0 },
    scheduling: { spec: { kind: 'interval', seconds: 900 }, enabled: true, revision: 2, nextAt: 1790270100000, error: null, pending: 0, blocked: 0, concurrency: 2 },
    runs: { runs: [{ id: '00000000-0000-4000-8000-000000000139', podId, scriptHash: 'a'.repeat(64), state: 'completed', startedAt: 1790269200000, finishedAt: 1790269260000, summary: 'All checks completed. No action required.', error: null, checkpointRevision: 4, recovery: null }], events: [] }, versions: {}, history: {},
  }
  const host: CentralRuntime = { id: runtimeId, revision: 1, online: true, workspace: { pods: [pod, { ...pod, id: '00000000-0000-4000-8000-000000000140', name: 'Monthly report', online: false }], organization: { revision: 1, groups: [] } } }
  let wake: (() => void) | null = null
  const client: CentralClient = {
    inventory: async () => structuredClone([host]),
    read: async () => ({ revision: host.revision, pod: structuredClone(view) }),
    command: async (_runtime, _revision, command, id) => ({ id, runtimeId, command, state: 'applied', result: null, error: null, revision: ++host.revision }),
    operation: async () => { throw new Error('No operation pending') },
    changes: (cursor, signal) => new Promise((resolve) => {
      const done = () => { signal.removeEventListener('abort', done); wake = null; resolve({ cursor: cursor + 1 }) }
      if (signal.aborted) { done(); return }
      wake = done; signal.addEventListener('abort', done, { once: true })
    }),
  }
  return { client, host, view, wake: () => wake?.() }
}
