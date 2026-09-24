import type { CentralClient, CentralOperation, CentralPod, CentralRuntime } from '../../contracts/central'

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
  return {
    inventory: () => request('inventory'),
    read: (runtimeId, podId) => request(`pod?${new URLSearchParams({ runtimeId, podId })}`),
    command: (runtimeId, revision, command, id) => request('commands', { runtimeId, revision, command, id }),
    operation: id => request(`operation?id=${encodeURIComponent(id)}`),
    changes: (cursor, signal) => request(`changes?cursor=${cursor}`, undefined, signal),
  }
}
export function desktopWorkspaceClient(bridge: (body: Record<string, unknown>) => Promise<unknown>): CentralClient {
  async function invoke(body: Record<string, unknown>): Promise<unknown> {
    const result = await bridge(body)
    if (result && typeof result === 'object' && 'requestError' in result) {
      const error = result.requestError as { status: number, message: string }
      throw new WorkspaceRequestError(error.status, error.message)
    }
    return result
  }
  return {
    inventory: async () => await invoke({ type: 'inventory' }) as CentralRuntime[],
    read: async (runtimeId, podId) => await invoke({ type: 'read', runtimeId, podId }) as { revision: number, pod: CentralPod },
    command: async (runtimeId, revision, command, id) => await invoke({ type: 'submit', runtimeId, revision, command, id }) as CentralOperation,
    operation: async id => await invoke({ type: 'operation', id }) as CentralOperation,
    changes: (_cursor, signal) => new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return }
      let timer: ReturnType<typeof setTimeout>
      const aborted = () => { clearTimeout(timer); reject(signal.reason) }
      timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve({ cursor: 0 }) }, 2000)
      signal.addEventListener('abort', aborted, { once: true })
    }),
  }
}
