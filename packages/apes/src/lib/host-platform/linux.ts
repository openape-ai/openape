// Linux HostPlatform impl. Identity + agent-user lookup go through
// `getent` + `/etc/machine-id`; supervisor + privileged-exec go through
// systemd + sudo. The agent-user lifecycle (create / destroy) is NOT a
// platform method — it's an orchestration concern in commands/agents/*
// that builds a bash script and hands it to `runPrivilegedBash`.
//
// IMPORTANT: side-effect-free at top level — imported on macOS too.

import { getLinuxHostId, getLinuxHostname } from './linux-host'
import { listLinuxUserNames, readLinuxUser } from './linux-user'
import { runAsAgentUserOnLinux, runPrivilegedBashOnLinux } from './linux-exec'
import { installNestSupervisorOnLinux, uninstallNestSupervisorOnLinux } from './linux-nest'
import type { AgentUserSummary, HostPlatform, OrphanRecord } from './index'

export const linuxHostPlatform: HostPlatform = {
  getHostId: getLinuxHostId,
  getHostname: getLinuxHostname,

  // No prefix on Linux — the agent name IS the OS username. In the
  // container, the OpenApe namespace IS the namespace; no need to
  // disambiguate with `openape-agent-`. (Linux limits usernames to
  // 32 chars, so a prefix would also reject longer agent names.)
  agentUsername: (agentName: string) => agentName,
  lookupAgentUser: (agentName: string): AgentUserSummary | null => readLinuxUser(agentName),
  readAgentUser: (osName: string): AgentUserSummary | null => readLinuxUser(osName),
  listAgentUserNames: listLinuxUserNames,
  // No tombstone concept on Linux — userdel + groupdel are clean.
  listOrphanAgentUsers: (): OrphanRecord[] => [],

  installNestSupervisor: installNestSupervisorOnLinux,
  uninstallNestSupervisor: uninstallNestSupervisorOnLinux,

  runPrivilegedBash: runPrivilegedBashOnLinux,
  runAsAgentUser: runAsAgentUserOnLinux,
}
