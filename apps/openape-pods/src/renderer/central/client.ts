import type { CentralClient, CentralOperation, CentralPod, CentralRunDetail, CentralRuntime, CentralSummary } from '../../contracts/central'
import type { RunRecord } from '../../contracts/runs'
import type { ScriptView } from '../../contracts/scripts'

export class WorkspaceRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export function browserWorkspaceClient(): CentralClient {
  async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/workspace/v1/${path}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    if (!response.ok) {
      const problem = await response.json() as { code?: string, error?: string }
      throw new WorkspaceRequestError(response.status, problem.code ?? problem.error ?? `Workspace request failed (${response.status})`)
    }
    return await response.json() as T
  }
  const pod = <T>(runtimeId: string, podId: string, view: Record<string, string>) => request<T>(`pod?${new URLSearchParams({ runtimeId, podId, ...view })}`)
  return {
    inventory: () => request('inventory'),
    read: (runtimeId, podId) => pod(runtimeId, podId, { view: 'summary' }),
    runs: (runtimeId, podId, offset) => pod(runtimeId, podId, { view: 'runs', offset: String(offset) }),
    run: (runtimeId, podId, runId) => pod(runtimeId, podId, { view: 'run', runId }),
    version: (runtimeId, podId, selection) => pod(runtimeId, podId, { view: 'version', selection }),
    command: (runtimeId, revision, command, id) => request('commands', { runtimeId, revision, command, id }),
    operation: id => request(`operation?id=${encodeURIComponent(id)}`),
    changes: (cursor, signal) => request(`changes?cursor=${cursor}`, undefined, signal),
  }
}

interface Legacy { revision: number, pod: CentralPod, total?: undefined }
// An older service ignores `view` and returns the complete Pod; derive the bounded view from it.
function legacy<T>(value: unknown, derive: (pod: CentralPod, revision: number) => T): T {
  return value && typeof value === 'object' && 'pod' in value && (value as Legacy).total === undefined ? derive((value as Legacy).pod, (value as Legacy).revision) : value as T
}

export function desktopWorkspaceClient(bridge: (body: Record<string, unknown>) => Promise<unknown>, pollMs = 5000): CentralClient {
  let longPoll = true
  async function invoke(body: Record<string, unknown>): Promise<unknown> {
    const result = await bridge(body)
    if (result && typeof result === 'object' && 'requestError' in result) {
      const error = result.requestError as { status: number, message: string }
      throw new WorkspaceRequestError(error.status, error.message)
    }
    return result
  }
  const read = (runtimeId: string, podId: string, view: Record<string, unknown>) => invoke({ type: 'read', runtimeId, podId, ...view })
  function timer(cursor: number, signal: AbortSignal): Promise<{ cursor: number }> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return }
      let timeout: ReturnType<typeof setTimeout>
      const aborted = () => { clearTimeout(timeout); reject(signal.reason) }
      timeout = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve({ cursor: cursor + 1 }) }, pollMs)
      signal.addEventListener('abort', aborted, { once: true })
    })
  }
  return {
    inventory: async () => await invoke({ type: 'inventory' }) as CentralRuntime[],
    read: async (runtimeId, podId) => legacy<CentralSummary>(await read(runtimeId, podId, { view: 'summary' }), (pod, revision) => ({ revision, total: pod.runs.runs.length, pod: { ...pod, history: {}, versions: {} } })),
    runs: async (runtimeId, podId, offset) => legacy<{ revision: number, total: number, runs: RunRecord[] }>(await read(runtimeId, podId, { view: 'runs', offset }), (pod, revision) => ({ revision, total: pod.runs.runs.length, runs: pod.runs.runs.slice(offset, offset + 20) })),
    run: async (runtimeId, podId, runId) => legacy<CentralRunDetail>(await read(runtimeId, podId, { view: 'run', runId }), (pod, revision) => {
      const view = pod.history[runId]
      const run = view?.runs.find(item => item.id === runId)
      if (!view || !run) throw new WorkspaceRequestError(404, 'run_not_found')
      return { revision, run, events: view.events }
    }),
    version: async (runtimeId, podId, selection) => legacy<{ revision: number, version: ScriptView }>(await read(runtimeId, podId, { view: 'version', selection }), (pod, revision) => {
      const version = pod.versions[selection]
      if (!version) throw new WorkspaceRequestError(404, 'version_not_found')
      return { revision, version }
    }),
    command: async (runtimeId, revision, command, id) => await invoke({ type: 'submit', runtimeId, revision, command, id }) as CentralOperation,
    operation: async id => await invoke({ type: 'operation', id }) as CentralOperation,
    changes: async (cursor, signal) => {
      if (!longPoll) return timer(cursor, signal)
      try { return await invoke({ type: 'changes', cursor }) as { cursor: number } }
      catch (error) {
        // An older service has no runtime change feed; poll instead of failing.
        if (!(error instanceof WorkspaceRequestError) || error.status !== 400) throw error
        longPoll = false
        return timer(cursor, signal)
      }
    },
  }
}
