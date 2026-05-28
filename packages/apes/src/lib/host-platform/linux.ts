// Linux HostPlatform impl — placeholder. Filled in Milestone B alongside
// `escapes-linux` + the container nest. All methods throw until then,
// except `listOrphanAgentUsers` which legitimately has no concept on
// Linux (userdel + groupdel are clean — no tombstones).
//
// IMPORTANT: keep this module side-effect-free at top level — it is
// imported on macOS too (the factory in ./index picks lazily).

import type {
  AgentUserSummary,
  ExecResult,
  HostPlatform,
  NestSupervisorSpec,
  OrphanRecord,
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

  installNestSupervisor: async (_s: NestSupervisorSpec): Promise<void> => notImplemented('installNestSupervisor'),
  uninstallNestSupervisor: async (): Promise<void> => notImplemented('uninstallNestSupervisor'),

  runPrivilegedBash: async (_script: string): Promise<void> => notImplemented('runPrivilegedBash'),
  runAsAgentUser: async (_n: string, _argv: string[]): Promise<ExecResult> => notImplemented('runAsAgentUser'),
}
