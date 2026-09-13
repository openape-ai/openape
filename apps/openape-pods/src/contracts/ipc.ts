import type { WorkspaceCommand, WorkspaceState } from './control'

export const channels = { status: 'pods:status', changed: 'pods:status-changed', workspace: 'pods:workspace' } as const
export type WorkerState = 'starting' | 'ready' | 'error' | 'stopped'
export interface WorkerStatus { state: WorkerState, pid: number | null, error: string | null }
export interface PodStatus {
  version: 1
  mode: 'fixture'
  executionEnabled: false
  worker: WorkerStatus
  runtime: { electron: string, node: string }
}
export interface PodsBridge {
  workspace: (command: WorkspaceCommand) => Promise<WorkspaceState>
  getStatus: () => Promise<PodStatus>
  onStatus: (listener: (status: PodStatus) => void) => () => void
}
export function isPodStatus(value: unknown): value is PodStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<PodStatus>
  const worker = status.worker
  return status.version === 1 && status.mode === 'fixture' && status.executionEnabled === false
    && !!worker && ['starting', 'ready', 'error', 'stopped'].includes(worker.state)
    && (worker.pid === null || (Number.isSafeInteger(worker.pid) && worker.pid > 0))
    && (worker.error === null || typeof worker.error === 'string')
    && typeof status.runtime?.electron === 'string' && typeof status.runtime.node === 'string'
}
