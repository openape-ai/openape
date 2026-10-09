import type { UpdateCommand, UpdateView } from './updates'
import type { DefinitionCommand, DefinitionsView } from './definitions'
import type { McpSessionCommand, McpSessionView } from './mcp-session'
import type { CodexCommand, CodexConnection } from './codex'
import type { NetworkCommand, NetworkView } from './networks'
import type { PackageSearch, PackageOption } from './package-catalog'
import type { ProgramCommand, TerminalView, ConsoleView } from './programs'
import type { LanguageCommand, Language } from './language'
import type { ScriptCommand, ScriptView } from './scripts'
import type { DataCommand, DataView } from './data'
import type { OnboardingCommand, OnboardingView } from './onboarding'
import type { MasterCommand, MasterView } from './master'
import type { DetailsCommand, PodDetails } from './details'
import type { ScheduleCommand, ScheduleView } from './scheduling'
import type { RunCommand, RunView } from './runs'
import type { SharingCommand, SharingState } from './sharing'
import type { ResourceCommand, ResourceState } from './resources'
import type { WorkspaceCommand, WorkspaceState } from './control'
import type { SecretsCommand, SecretsView } from './secrets'

export const channels = { updates: 'pods:updates', mcpSession: 'pods:mcp-session', central: 'pods:central', codex: 'pods:codex', networks: 'pods:networks', definitions: 'pods:definitions', packages: 'pods:packages', programs: 'pods:programs', language: 'pods:language', scripts: 'pods:scripts', data: 'pods:data', onboarding: 'pods:onboarding', master: 'pods:master', details: 'pods:details', status: 'pods:status', changed: 'pods:status-changed', workspace: 'pods:workspace', resources: 'pods:resources', runs: 'pods:runs', scheduling: 'pods:scheduling', sharing: 'pods:sharing', secrets: 'pods:secrets' } as const
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
  updates?: (command: UpdateCommand) => Promise<UpdateView>
  mcpSession: (command: McpSessionCommand) => Promise<McpSessionView>
  central?: (command: Record<string, unknown>) => Promise<unknown>
  codex: (command: CodexCommand) => Promise<CodexConnection>
  definitions: (command: DefinitionCommand) => Promise<DefinitionsView>
  // Optional like central: fixtures of older surfaces omit it; the preload always provides it.
  sharing?: (command: SharingCommand) => Promise<SharingState>
  networks: (command: NetworkCommand) => Promise<NetworkView>
  packages: (command: PackageSearch) => Promise<PackageOption[]>
  programs: (command: ProgramCommand) => Promise<ResourceState | TerminalView | ConsoleView | null>
  language: (command: LanguageCommand) => Promise<Language>
  scripts: (command: ScriptCommand) => Promise<ScriptView>
  data: (command: DataCommand) => Promise<DataView>
  onboarding: (command: OnboardingCommand) => Promise<OnboardingView>
  master: (command: MasterCommand) => Promise<MasterView>
  details: (command: DetailsCommand) => Promise<PodDetails>
  /** Desktop only: the native store, the private file and the request at OpenApe Secrets. */
  secrets?: (command: SecretsCommand) => Promise<SecretsView>
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
