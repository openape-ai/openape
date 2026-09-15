import type { PodResource } from '../../contracts/resources'

export function modelResources(resources: PodResource[]) {
  return resources.map(({ id, revision, kind, state, name, configuration }) => {
    const visible: Record<string, unknown> = {}
    for (const key of ['type', 'cliId', 'capability', 'alias', 'origin']) {
      if (typeof configuration[key] === 'string') visible[key] = configuration[key]
    }
    if (Array.isArray(configuration.methods)) visible.methods = configuration.methods.filter(value => typeof value === 'string')
    if (Array.isArray(configuration.grants)) visible.permissions = configuration.grants.map(grant => (grant as { permission: string }).permission)
    return { id, revision, kind, state, name, configuration: visible }
  })
}
