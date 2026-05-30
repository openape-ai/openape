// Linux HostPlatform impl — placeholder. Filled in T12 (skeleton) and
// expanded in Milestone B (functional, with escapes-linux + systemd).
// All methods throw until then.
//
// IMPORTANT: keep this module side-effect-free at top level — it is
// imported on macOS too (the factory in ./index picks lazily).

import type {
  AgentUserSummary,
  BridgeSupervisorSpec,
  CreateAgentUserSpec,
  DestroyAgentUserSpec,
  ExecResult,
  HostPlatform,
  NestSupervisorSpec,
  OrphanRecord,
  SyncSupervisorSpec,
} from './index'

function notImplemented(method: string): never {
  throw new Error(`linuxHostPlatform.${method} not implemented (Milestone B)`)
}

export const linuxHostPlatform: HostPlatform = {
  getHostId: () => notImplemented('getHostId'),
  getHostname: () => notImplemented('getHostname'),

  agentUsername: (_n: string) => notImplemented('agentUsername'),
  lookupAgentUser: (_n: string): AgentUserSummary | null => notImplemented('lookupAgentUser'),
  readAgentUser: (_n: string): AgentUserSummary | null => notImplemented('readAgentUser'),
  listAgentUserNames: (): Set<string> => notImplemented('listAgentUserNames'),
  // No tombstone concept on Linux — userdel + groupdel are clean. Safe default.
  listOrphanAgentUsers: (): OrphanRecord[] => [],

  createAgentUser: async (_s: CreateAgentUserSpec): Promise<AgentUserSummary> => notImplemented('createAgentUser'),
  destroyAgentUser: async (_s: DestroyAgentUserSpec): Promise<void> => notImplemented('destroyAgentUser'),

  installBridgeSupervisor: async (_s: BridgeSupervisorSpec): Promise<void> => notImplemented('installBridgeSupervisor'),
  removeBridgeSupervisor: async (_n: string): Promise<void> => notImplemented('removeBridgeSupervisor'),
  restartBridgeSupervisor: async (_n: string): Promise<void> => notImplemented('restartBridgeSupervisor'),
  installSyncSupervisor: async (_s: SyncSupervisorSpec): Promise<void> => notImplemented('installSyncSupervisor'),
  removeSyncSupervisor: async (_n: string): Promise<void> => notImplemented('removeSyncSupervisor'),
  installNestSupervisor: async (_s: NestSupervisorSpec): Promise<void> => notImplemented('installNestSupervisor'),
  uninstallNestSupervisor: async (_s: NestSupervisorSpec): Promise<void> => notImplemented('uninstallNestSupervisor'),

  runAsAgentUser: async (_n: string, _argv: string[]): Promise<ExecResult> => notImplemented('runAsAgentUser'),
}
