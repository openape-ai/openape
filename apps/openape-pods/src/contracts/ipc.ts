import type { DataCommand, DataView } from './data'
import type { OnboardingCommand, OnboardingView } from './onboarding'
import type { MasterCommand, MasterView } from './master'
import type { DetailsCommand, PodDetails } from './details'
import type { ScheduleCommand, ScheduleView } from './scheduling'
import type { RunCommand, RunView } from './runs'
import type { ResourceCommand, ResourceState } from './resources'
import type { WorkspaceCommand, WorkspaceState } from './control'

export const channels = { data: 'pods:data', onboarding: 'pods:onboarding', master: 'pods:master', details: 'pods:details', status: 'pods:status', changed: 'pods:status-changed', workspace: 'pods:workspace', resources: 'pods:resources', runs: 'pods:runs', scheduling: 'pods:scheduling' } as const
export type WorkerState = 'starting' | 'ready' | 'error' | 'stopped'
export interface WorkerStatus { state: WorkerState, pid: number | null, error: string | null }
export interface PodStatus {
  version: 1
  mode: 'fixture' | 'local'
  executionEnabled: true
  worker: WorkerStatus
  runtime: { electron: string, node: string }
}
export interface PodsBridge {
  data: (command: DataCommand) => Promise<DataView>
  onboarding: (command: OnboardingCommand) => Promise<OnboardingView>
  master: (command: MasterCommand) => Promise<MasterView>
  details: (command: DetailsCommand) => Promise<PodDetails>
  scheduling: (command: ScheduleCommand) => Promise<ScheduleView>
  runs: (command: RunCommand) => Promise<RunView>
  resources: (command: ResourceCommand) => Promise<ResourceState>
  workspace: (command: WorkspaceCommand) => Promise<WorkspaceState>
  getStatus: () => Promise<PodStatus>
  onStatus: (listener: (status: PodStatus) => void) => () => void
}
export function isPodStatus(value: unknown): value is PodStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<PodStatus>
  const worker = status.worker
  return status.version === 1 && ['fixture', 'local'].includes(status.mode ?? '') && status.executionEnabled === true
    && !!worker && ['starting', 'ready', 'error', 'stopped'].includes(worker.state)
    && (worker.pid === null || (Number.isSafeInteger(worker.pid) && worker.pid > 0))
    && (worker.error === null || typeof worker.error === 'string')
    && typeof status.runtime?.electron === 'string' && typeof status.runtime.node === 'string'
}
