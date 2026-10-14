import type { PodResource } from '../../contracts/resources'

/**
 * The Pod's resources as Codex and the owner window see them. A program shows its command name and whether it runs
 * through a runtime descriptor; what its commands mean is decided by the IdP per call (issue 1473, revision 4).
 */
export function modelResources(resources: PodResource[], includeRuntime = false) {
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
    if (includeRuntime && state === 'ready' && configuration.type === 'program') visible.runtimeConfigured = Boolean(configuration.runtime)
    return { id, revision, kind, state, name, configuration: visible }
  })
}
