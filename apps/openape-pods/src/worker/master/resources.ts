import { loadAdapter } from '@openape/apes'
import type { PodResource } from '../../contracts/resources'
import { adapterStanding } from '../../contracts/programs'
import type { ProgramAssignment } from '../../contracts/programs'

export function modelResources(resources: PodResource[], includeCommands = false) {
  return resources.map(({ id, revision, kind, state, name, configuration }) => {
    const visible: Record<string, unknown> = {}
    for (const key of ['type', 'cliId', 'capability', 'alias', 'origin']) {
      if (typeof configuration[key] === 'string') visible[key] = configuration[key]
    }
    if (configuration.type === 'sshInventory') visible.target = configuration.target
    if (configuration.type === 'jev') { visible.connectionId = configuration.connectionId; visible.model = configuration.model; visible.maxAttempts = configuration.maxAttempts }
    if (kind === 'directory') { visible.path = configuration.path; visible.access = configuration.access }
    if (Array.isArray(configuration.networkHosts)) visible.networkHosts = configuration.networkHosts.filter(value => typeof value === 'string')
    if (Array.isArray(configuration.methods)) visible.methods = configuration.methods.filter(value => typeof value === 'string')
    if (configuration.type === 'program') visible.adapter = programAdapter(configuration as unknown as ProgramAssignment)
    if (includeCommands && state === 'ready' && configuration.type === 'program') {
      const adapter = loadAdapter(String(configuration.cliId), String(configuration.adapterPath))
      if (adapter.fileDigest.replace('SHA-256:', '') !== configuration.adapterHash) throw new Error('Application command reference changed; reassign the application in Permissions')
      visible.commands = adapter.adapter.operations
      visible.runtimeConfigured = Boolean(configuration.runtime)
    }
    return { id, revision, kind, state, name, configuration: visible }
  })
}

/** Where an application's adapter comes from and why its commands need exact approvals, if they do (issue 1473). */
function programAdapter(assignment: ProgramAssignment) {
  const standing = adapterStanding(assignment)
  return { registry: assignment.registry?.id ?? null, cliVersion: assignment.cliVersion?.version ?? null, exactApprovals: standing.exact ? standing.reason : null }
}
