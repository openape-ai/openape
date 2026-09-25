import { loadAdapter } from '@openape/apes'
import type { PodResource } from '../../contracts/resources'

export function modelResources(resources: PodResource[], includeCommands = false) {
  return resources.map(({ id, revision, kind, state, name, configuration }) => {
    const visible: Record<string, unknown> = {}
    for (const key of ['type', 'cliId', 'capability', 'alias', 'origin']) {
      if (typeof configuration[key] === 'string') visible[key] = configuration[key]
    }
    if (configuration.type === 'jev') { visible.connectionId = configuration.connectionId; visible.model = configuration.model; visible.maxAttempts = configuration.maxAttempts }
    if (kind === 'directory') { visible.path = configuration.path; visible.access = configuration.access }
    if (Array.isArray(configuration.networkHosts)) visible.networkHosts = configuration.networkHosts.filter(value => typeof value === 'string')
    if (Array.isArray(configuration.methods)) visible.methods = configuration.methods.filter(value => typeof value === 'string')
    if (includeCommands && state === 'ready' && configuration.type === 'program') {
      const adapter = loadAdapter(String(configuration.cliId), String(configuration.adapterPath))
      if (adapter.digest.replace('SHA-256:', '') !== configuration.adapterHash) throw new Error('Application command reference changed; reassign the application in Permissions')
      visible.commands = adapter.adapter.operations
      visible.runtimeConfigured = Boolean(configuration.runtime)
    }
    if (Array.isArray(configuration.grants)) visible.permissions = configuration.grants.map(grant => (grant as { permission: string }).permission)
    return { id, revision, kind, state, name, configuration: visible }
  })
}
