// macOS HostPlatform impl. The read methods (identity, agent-user lookup,
// orphan scan) delegate to the existing `lib/macos-host` + `lib/macos-user`
// modules — those stay in place so call sites already migrated to the
// interface in PR #494 keep working. Privileged execution + nest
// supervisor live in dedicated submodules so this entry point is small.
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
import { installNestSupervisorOnDarwin, uninstallNestSupervisorOnDarwin } from './darwin-nest'
import { runAsAgentUserOnDarwin, runPrivilegedBashOnDarwin } from './darwin-exec'
import type {
  AgentUserSummary,
  HostPlatform,
  OrphanRecord,
} from './index'

export const darwinHostPlatform: HostPlatform = {
  getHostId,
  getHostname,

  agentUsername: macOSUsernameForAgent,
  lookupAgentUser: (agentName: string): AgentUserSummary | null => lookupMacOSUserForAgent(agentName),
  readAgentUser: (osName: string): AgentUserSummary | null => readMacOSUser(osName),
  listAgentUserNames: listMacOSUserNames,
  listOrphanAgentUsers: (): OrphanRecord[] =>
    listOrphanedAgentRecords().map(r => ({ name: r.name, uid: r.uid, homeDir: r.homeDir })),

  installNestSupervisor: installNestSupervisorOnDarwin,
  uninstallNestSupervisor: uninstallNestSupervisorOnDarwin,

  runPrivilegedBash: runPrivilegedBashOnDarwin,
  runAsAgentUser: runAsAgentUserOnDarwin,
}
