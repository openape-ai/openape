// macOS HostPlatform impl. The read methods (identity, agent-user lookup,
// orphan scan) delegate to the existing `lib/macos-host` + `lib/macos-user`
// modules — those modules stay in place during the Milestone A migration
// so call sites can move onto `getHostPlatform()` one at a time without
// a flag-day rename. The lifecycle + supervisor methods will be wired
// once `commands/agents/spawn` + `commands/agents/destroy` are refactored
// to consume the interface (follow-up milestone within Milestone A).
//
// IMPORTANT: keep this module side-effect-free at top level. It is
// imported on Linux too (the factory in ./index picks lazily); a
// top-level `execFileSync('dscl', …)` would crash the Linux build. All
// child_process / dscl invocations live inside the imported helpers.

import { getHostId, getHostname } from '../macos-host'
import {
  listMacOSUserNames,
  listOrphanedAgentRecords,
  lookupMacOSUserForAgent,
  macOSUsernameForAgent,
  readMacOSUser,
} from '../macos-user'
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

function pending(method: string): never {
  throw new Error(`darwinHostPlatform.${method} not wired yet (Milestone A follow-up)`)
}

export const darwinHostPlatform: HostPlatform = {
  getHostId,
  getHostname,

  agentUsername: macOSUsernameForAgent,
  lookupAgentUser: (agentName: string): AgentUserSummary | null => lookupMacOSUserForAgent(agentName),
  readAgentUser: (osName: string): AgentUserSummary | null => readMacOSUser(osName),
  listAgentUserNames: listMacOSUserNames,
  listOrphanAgentUsers: (): OrphanRecord[] =>
    listOrphanedAgentRecords().map(r => ({ name: r.name, uid: r.uid, homeDir: r.homeDir })),

  createAgentUser: async (_s: CreateAgentUserSpec): Promise<AgentUserSummary> => pending('createAgentUser'),
  destroyAgentUser: async (_s: DestroyAgentUserSpec): Promise<void> => pending('destroyAgentUser'),

  installBridgeSupervisor: async (_s: BridgeSupervisorSpec): Promise<void> => pending('installBridgeSupervisor'),
  removeBridgeSupervisor: async (_n: string): Promise<void> => pending('removeBridgeSupervisor'),
  restartBridgeSupervisor: async (_n: string): Promise<void> => pending('restartBridgeSupervisor'),
  installSyncSupervisor: async (_s: SyncSupervisorSpec): Promise<void> => pending('installSyncSupervisor'),
  removeSyncSupervisor: async (_n: string): Promise<void> => pending('removeSyncSupervisor'),
  installNestSupervisor: async (_s: NestSupervisorSpec): Promise<void> => pending('installNestSupervisor'),
  uninstallNestSupervisor: async (_s: NestSupervisorSpec): Promise<void> => pending('uninstallNestSupervisor'),

  runAsAgentUser: async (_n: string, _argv: string[]): Promise<ExecResult> => pending('runAsAgentUser'),
}
